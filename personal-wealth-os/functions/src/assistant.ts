/**
 * AI-assistant proxy (Cloud Functions, 2nd gen).
 *
 * The browser must never hold the OpenRouter key, so this function is the only
 * thing that talks to OpenRouter. It validates the chat request (see
 * openrouterRequest.ts), forwards it to the fixed free model, and returns just
 * the reply text. No user data is stored; nothing about the key ever reaches
 * the client, including in an error.
 *
 * Two modes are carried, both shaped by openrouterRequest.ts: "help" answers in
 * prose, "fill" answers with one JSON action object that the browser parses and
 * validates against the live state. Either way this handler only moves text —
 * it never writes anything, and nothing it returns can change data on its own.
 */

import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import * as logger from "firebase-functions/logger";
import { guardHelpReply } from "./answerGuard.js";
import { resolveCors } from "./cors.js";
import { checkRateLimit, clientKeyFromHeaders } from "./rateLimit.js";
import {
  OPENROUTER_CHAT_URL,
  buildOpenRouterPayload,
  parseOpenRouterReply,
} from "./openrouterRequest.js";

const OPENROUTER_API_KEY = defineSecret("OPENROUTER_API_KEY");

/** One conversational turn a minute is plenty; 15 leaves slack for retries. */
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 15;

/** The free model can be slow; give it room but never hang the function. */
const UPSTREAM_TIMEOUT_MS = 25_000;

export const assistant = onRequest(
  {
    region: "us-central1",
    secrets: [OPENROUTER_API_KEY],
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

    const built = buildOpenRouterPayload(body);
    if (!built.ok) {
      response.status(built.status).json({ error: built.error });
      return;
    }

    let upstream: Awaited<ReturnType<typeof fetch>>;
    try {
      upstream = await fetch(OPENROUTER_CHAT_URL, {
        method: "POST",
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        headers: {
          Authorization: `Bearer ${OPENROUTER_API_KEY.value()}`,
          "Content-Type": "application/json",
          // OpenRouter attribution headers (optional, but recommended).
          "HTTP-Referer": "https://wealthup.cc",
          "X-Title": "WealthUp",
        },
        body: JSON.stringify(built.payload),
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "TimeoutError";
      logger.warn("assistant upstream fetch failed", { timedOut });
      response.status(504).json({ error: timedOut ? "The assistant timed out." : "The assistant is unreachable." });
      return;
    }

    if (upstream.status === 429) {
      response.status(429).json({ error: "The assistant is busy. Try again shortly." });
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

    const parsed = parseOpenRouterReply(json);
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
