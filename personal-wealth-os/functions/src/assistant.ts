/**
 * AI-assistant proxy (Cloud Functions, 2nd gen).
 *
 * The browser must never hold the DeepSeek key, so this function is the only
 * thing that talks to DeepSeek. It validates the chat request (see
 * deepseekRequest.ts), forwards it to the model fixed for that mode, and
 * returns just the reply text. No user data is stored; nothing about the key
 * ever reaches the client, including in an error.
 *
 * Two modes are carried, both shaped by deepseekRequest.ts: "help" answers in
 * prose, "fill" answers with one JSON action object that the browser parses and
 * validates against the live state. Either way this handler only moves text —
 * it never writes anything, and nothing it returns can change data on its own.
 */

import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import * as logger from "firebase-functions/logger";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { guardHelpReply } from "./answerGuard.js";
import { resolveCors } from "./cors.js";
import { checkRateLimit, clientKeyFromHeaders } from "./rateLimit.js";
import {
  DEEPSEEK_CHAT_URL,
  buildDeepSeekPayload,
  parseDeepSeekReply,
} from "./deepseekRequest.js";
import { bearerToken, dayKeyFor, decideQuota, usageDocId, type QuotaDecision } from "./quota.js";

const DEEPSEEK_API_KEY = defineSecret("DEEPSEEK_API_KEY");

/**
 * The admin app, created once per instance and shared by every invocation.
 * It runs with the project's own credentials, which is what lets it write the
 * usage counters that `firestore.rules` denies to every client.
 */
initializeApp();

/** Where the counters live. Clients cannot read or write this collection. */
const USAGE_COLLECTION = "assistantUsage";

/** One conversational turn a minute is plenty; 15 leaves slack for retries. */
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 15;

/** The model can be slow at peak hours; give it room but never hang the function. */
const UPSTREAM_TIMEOUT_MS = 25_000;

export const assistant = onRequest(
  {
    region: "us-central1",
    secrets: [DEEPSEEK_API_KEY],
    timeoutSeconds: 30,
    memory: "256MiB",
    maxInstances: 5,
    cors: false, // handled here so the policy is one tested function
  },
  async (request, response) => {
    const cors = resolveCors(request.headers.origin);
    for (const [name, value] of Object.entries(cors.headers)) response.setHeader(name, value);

    if (request.method === "OPTIONS") {
      response.status(cors.allowed ? 204 : 403).end();
      return;
    }
    if (!cors.allowed) {
      response.status(403).json({ error: "Forbidden" });
      return;
    }
    if (request.method !== "POST") {
      response.setHeader("Allow", "POST");
      response.status(405).json({ error: "Method not allowed" });
      return;
    }

    const rate = checkRateLimit(clientKeyFromHeaders(request.headers), {
      bucket: "assistant",
      windowMs: RATE_WINDOW_MS,
      max: RATE_MAX,
    });
    response.setHeader("RateLimit-Limit", String(rate.limit));
    response.setHeader("RateLimit-Remaining", String(rate.remaining));
    response.setHeader("RateLimit-Reset", String(rate.resetSec));
    if (!rate.ok) {
      response.setHeader("Retry-After", String(rate.retryAfterSec));
      response.status(429).json({ error: "Too many requests; wait a moment." });
      return;
    }

    // firebase-functions parses application/json into request.body; tolerate a
    // raw string too (some clients send text/plain).
    let body: unknown = request.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        response.status(400).json({ error: "Body must be valid JSON" });
        return;
      }
    }

    const built = buildDeepSeekPayload(body);
    if (!built.ok) {
      response.status(built.status).json({ error: built.error });
      return;
    }

    // From here the request costs real money, so it has to belong to somebody.
    // A signed-in account is the only thing a daily allowance can be counted
    // against: an IP is shared, spoofable and forgotten on a cold start.
    const idToken = bearerToken(request.headers);
    if (idToken.length === 0) {
      response.status(401).json({ error: "Sign in to use the assistant.", reason: "signed-out" });
      return;
    }
    let uid: string;
    try {
      uid = (await getAuth().verifyIdToken(idToken)).uid;
    } catch {
      // Expired, malformed, or for another project. Never log the token.
      response.status(401).json({ error: "Sign in again to use the assistant.", reason: "signed-out" });
      return;
    }

    // Today's allowance, counted in Firestore so it survives a cold start and
    // holds across instances. The turn is charged here, before the model is
    // called: a refused turn costs nothing, and a turn the model then fails to
    // answer still costs one — which is the safe way round for a bill.
    const now = Date.now();
    const firestore = getFirestore();
    const usageRef = firestore.collection(USAGE_COLLECTION).doc(usageDocId(uid, now));
    let quota: QuotaDecision;
    try {
      quota = await firestore.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(usageRef);
        const decision = decideQuota(snapshot.data(), built.mode, now);
        if (decision.allowed) {
          transaction.set(
            usageRef,
            {
              uid,
              day: dayKeyFor(now),
              [built.mode]: FieldValue.increment(1),
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true },
          );
        }
        return decision;
      });
    } catch (error) {
      // Fail closed. Letting turns through while the counter is unreachable
      // would lift the ceiling exactly when something is already wrong.
      logger.error("assistant quota unavailable", { reason: error instanceof Error ? error.message : "unknown" });
      response.status(503).json({ error: "The assistant is unavailable right now." });
      return;
    }
    if (!quota.allowed) {
      logger.info("assistant daily allowance used up", { mode: built.mode });
      response.status(429).json({
        error: "You have used today's assistant allowance.",
        reason: "daily-quota",
        retryAt: quota.resetAt,
      });
      return;
    }
    response.setHeader("Assistant-Quota-Remaining", String(quota.remaining));

    let upstream: Awaited<ReturnType<typeof fetch>>;
    try {
      upstream = await fetch(DEEPSEEK_CHAT_URL, {
        method: "POST",
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        headers: {
          Authorization: `Bearer ${DEEPSEEK_API_KEY.value()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(built.payload),
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "TimeoutError";
      logger.warn("assistant upstream fetch failed", { timedOut });
      response.status(504).json({ error: timedOut ? "The assistant timed out." : "The assistant is unreachable." });
      return;
    }

    // DeepSeek's 429 is a concurrency limit, not a daily allowance: it clears
    // in moments, so "try again shortly" is the honest thing to say. (The old
    // free tier's per-day cap, which lasted hours, is gone with it.)
    if (upstream.status === 429) {
      logger.warn("assistant upstream at capacity");
      response.status(429).json({ error: "The assistant is busy. Try again shortly." });
      return;
    }
    // 402 = the prepaid balance is empty; 401 = the key is missing or revoked.
    // Both are ours to fix, not the user's, and neither is something to explain
    // to them — the panel says the assistant is unavailable while the log says
    // which one it was. The account balance is the thing to check first.
    if (upstream.status === 402 || upstream.status === 401) {
      logger.error("assistant cannot bill upstream", { status: upstream.status });
      response.status(503).json({ error: "The assistant is unavailable right now." });
      return;
    }
    if (!upstream.ok) {
      logger.error("assistant upstream error", { status: upstream.status });
      response.status(502).json({ error: "The assistant is unavailable." });
      return;
    }

    let json: unknown;
    try {
      json = await upstream.json();
    } catch {
      logger.error("assistant upstream returned non-JSON");
      response.status(502).json({ error: "The assistant returned an unreadable response." });
      return;
    }

    const parsed = parseDeepSeekReply(json);
    if (!parsed.ok) {
      logger.error("assistant reply not usable", { reason: parsed.error });
      response.status(502).json({ error: "The assistant returned nothing usable." });
      return;
    }

    // Ask answers get one last check for the mistake WealthUp must never deliver
    // (see answerGuard.ts). Record answers are JSON actions the browser validates,
    // so they are left alone.
    if (built.mode === "help") {
      const lastUser = [...built.payload.messages].reverse().find((message) => message.role === "user");
      const guarded = guardHelpReply(parsed.reply, lastUser?.content ?? "");
      if (guarded.replaced) {
        // Log that it happened, never what was said: the text can hold the
        // user's own figures.
        logger.warn("assistant reply replaced by emergency-fund guard");
      }
      response.status(200).json({ reply: guarded.reply, mode: built.mode });
      return;
    }

    response.status(200).json({ reply: parsed.reply, mode: built.mode });
  },
);
