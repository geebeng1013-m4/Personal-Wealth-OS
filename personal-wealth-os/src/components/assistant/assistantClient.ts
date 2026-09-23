/**
 * The browser's side of the assistant proxy.
 *
 * The OpenRouter key lives only in the Cloud Function; this module knows one
 * URL and nothing else. Every failure resolves to a typed `{ ok: false }` with
 * a sentence the panel can show a person — a thrown error here would surface as
 * a silent dead panel, which is the one outcome worse than a bad answer.
 */

import type { AssistantMode } from "./assistantTypes";
import { dailyLimitMessage } from "./quotaMessage";

/**
 * The deployed function. Overridable so a local run can point at the Firebase
 * emulator (set VITE_ASSISTANT_ENDPOINT in .env.local) without touching code.
 */
const DEFAULT_ENDPOINT = "https://us-central1-personal-wealth-os-1deac.cloudfunctions.net/assistant";

export function assistantEndpoint(): string {
  const configured = import.meta.env.VITE_ASSISTANT_ENDPOINT;
  return typeof configured === "string" && configured.trim().length > 0
    ? configured.trim()
    : DEFAULT_ENDPOINT;
}

export interface AssistantTurn {
  role: "user" | "assistant";
  content: string;
}

export interface AssistantRequest {
  messages: AssistantTurn[];
  mode: AssistantMode;
  /** Vocabulary or figures, built by assistantContext. "" to send nothing. */
  context: string;
}

/**
 * Where the caller's Firebase ID token comes from.
 *
 * The server counts a daily allowance per account, so every request has to say
 * whose it is. Firebase is injected rather than imported for the same reason
 * assistantSync takes its cloud as an argument: this module stays testable
 * without it, and the demo account simply never sets one.
 *
 * Returning null means "nobody is signed in" — the request is still sent, and
 * the server answers 401. Deciding here would only duplicate that rule badly.
 */
export type AssistantTokenProvider = () => Promise<string | null>;

let tokenProvider: AssistantTokenProvider | null = null;

export function setAssistantTokenProvider(provider: AssistantTokenProvider | null): void {
  tokenProvider = provider;
}

async function authHeader(): Promise<Record<string, string>> {
  if (!tokenProvider) return {};
  try {
    const token = await tokenProvider();
    return typeof token === "string" && token.length > 0 ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    // A token refresh can fail offline. Send the request without it and let
    // the server's 401 be the single place that says "sign in".
    return {};
  }
}

export type AssistantResponse =
  | { ok: true; reply: string }
  | { ok: false; error: string };

/** The panel gives up well before the function's own 30s ceiling would bite. */
const REQUEST_TIMEOUT_MS = 28_000;

function messageForStatus(status: number, body: unknown): string {
  const serverError = typeof (body as { error?: unknown } | null)?.error === "string"
    ? (body as { error: string }).error
    : "";

  if (status === 429) {
    // This account's daily allowance is a different problem from a busy
    // moment: it lasts until midnight, so say when it comes back instead of
    // "try again shortly".
    if ((body as { reason?: unknown } | null)?.reason === "daily-quota") {
      return dailyLimitMessage((body as { retryAt?: unknown }).retryAt, new Date());
    }
    return serverError || "Too many requests just now. Give it a moment and try again.";
  }
  if (status === 403) return "This page is not allowed to reach the assistant.";
  if (status === 400) return serverError || "That request could not be sent.";
  if (status === 504) return "The assistant took too long to answer. Try again.";
  if (status >= 500) return serverError || "The assistant is unavailable right now.";
  return serverError || `The assistant failed (${status}).`;
}

export async function askAssistant(request: AssistantRequest, signal?: AbortSignal): Promise<AssistantResponse> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  // Either the caller cancelling or the timeout should stop the request.
  // AbortSignal.any is recent enough to be worth a guard: without it the
  // caller's cancel is simply not wired in, which is a far smaller loss than
  // the whole panel throwing on an older browser.
  // The timeout is the one that must always be wired in — a stale reply is
  // already discarded by the caller's isCurrent() check, but a hung request
  // would leave the panel showing a typing indicator forever.
  const combined = signal && typeof AbortSignal.any === "function"
    ? AbortSignal.any([signal, timeout])
    : timeout;

  const auth = await authHeader();

  let response: Response;
  try {
    response = await fetch(assistantEndpoint(), {
      method: "POST",
      signal: combined,
      headers: { "Content-Type": "application/json", ...auth },
      body: JSON.stringify({
        messages: request.messages,
        mode: request.mode,
        ...(request.context.length > 0 ? { context: request.context } : {}),
      }),
    });
  } catch (error) {
    if (signal?.aborted) return { ok: false, error: "Cancelled." };
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    return {
      ok: false,
      error: timedOut
        ? "The assistant took too long to answer. Try again."
        : "Could not reach the assistant. Check your connection.",
    };
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Leave body null; the status still decides the message.
  }

  if (!response.ok) return { ok: false, error: messageForStatus(response.status, body) };

  const reply = (body as { reply?: unknown } | null)?.reply;
  if (typeof reply !== "string" || reply.trim().length === 0) {
    return { ok: false, error: "The assistant returned an empty answer." };
  }
  return { ok: true, reply: reply.trim() };
}
