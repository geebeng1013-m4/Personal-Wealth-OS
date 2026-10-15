/**
 * The browser's side of the assistant proxy.
 *
 * The DeepSeek key lives only in the Cloud Function; this module knows one
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
  const configured = import.meta.env?.VITE_ASSISTANT_ENDPOINT;
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
 * Returning null means there is no usable session. Never send private context
 * without a token; the server independently verifies every authenticated request.
 */
export type AssistantTokenProvider = (forceRefresh?: boolean) => Promise<string | null>;

let tokenProvider: AssistantTokenProvider | null = null;
let sessionController = new AbortController();

export function setAssistantTokenProvider(provider: AssistantTokenProvider | null): void {
  sessionController.abort();
  sessionController = new AbortController();
  tokenProvider = provider;
}

/**
 * Whether anyone is signed in, as far as the assistant is concerned.
 *
 * The panel asks this so it can say "sign in" instead of offering a composer
 * that can only ever come back 401 — which is what demo mode would do, since
 * it never signs in at all. It is not a security check: the server's token
 * check is, and it does not trust this or anything else the browser says.
 */
export function assistantSignedIn(): boolean {
  return tokenProvider !== null;
}

/** Bound token acquisition by the same cancellation and timeout as the request. */
async function requestToken(provider: AssistantTokenProvider, refresh: boolean, signal: AbortSignal): Promise<string | null> {
  let onAbort: () => void = () => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(new DOMException("Cancelled", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
    return await Promise.race([provider(refresh), aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

export type AssistantResponse =
  | { ok: true; reply: string }
  | { ok: false; error: string };

/** The panel gives up well before the function's own 30s ceiling would bite. */
const REQUEST_TIMEOUT_MS = 28_000;

function messageForStatus(status: number, body: unknown, mode: AssistantMode): string {
  const serverError = typeof (body as { error?: unknown } | null)?.error === "string"
    ? (body as { error: string }).error
    : "";

  if (status === 429) {
    // This account's daily allowance is a different problem from a busy
    // moment: it lasts until midnight, so say when it comes back instead of
    // "try again shortly".
    if ((body as { reason?: unknown } | null)?.reason === "daily-quota") {
      return dailyLimitMessage((body as { retryAt?: unknown }).retryAt, new Date(), undefined, mode);
    }
    return serverError || "Too many requests just now. Give it a moment and try again.";
  }
  if (status === 403) return "This page is not allowed to reach the assistant.";
  if (status === 401) return "Your session could not be verified. Sign in again to use the assistant.";
  if (status === 400) return serverError || "That request could not be sent.";
  if (status === 504) return "The assistant took too long to answer. Try again.";
  if (status >= 500) return serverError || "The assistant is unavailable right now.";
  return serverError || `The assistant failed (${status}).`;
}

export async function askAssistant(request: AssistantRequest, signal?: AbortSignal): Promise<AssistantResponse> {
  const provider = tokenProvider;
  if (!provider) return { ok: false, error: "Sign in to use the assistant." };
  const session = sessionController.signal;
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const controller = new AbortController();
  const sources = [session, timeout, ...(signal ? [signal] : [])];
  const abort = (): void => controller.abort();
  sources.forEach((source) => {
    if (source.aborted) abort();
    else source.addEventListener("abort", abort, { once: true });
  });
  const cancelled = (): boolean => session.aborted || signal?.aborted === true;
  const abortedResult = (): AssistantResponse => ({
    ok: false,
    error: cancelled() ? "Cancelled." : "The assistant took too long to answer. Try again.",
  });
  try {
    // Only a 401 is retried: token verification happens before quota charging
    // or calling the model, so this cannot spend the daily allowance twice.
    for (let attempt = 0; attempt < 2; attempt++) {
      if (controller.signal.aborted) return abortedResult();
      let token: string | null;
      try {
        token = await requestToken(provider, attempt === 1, controller.signal);
      } catch {
        if (controller.signal.aborted) return abortedResult();
        return { ok: false, error: "Could not verify your session. Check your connection and try again." };
      }
      if (controller.signal.aborted) return abortedResult();
      if (typeof token !== "string" || !token.trim()) {
        return { ok: false, error: "Your session is unavailable. Sign in again to use the assistant." };
      }
      let response: Response;
      try {
        response = await fetch(assistantEndpoint(), {
          method: "POST",
          signal: controller.signal,
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            messages: request.messages,
            mode: request.mode,
            ...(request.context.length > 0 ? { context: request.context } : {}),
          }),
        });
      } catch {
        if (controller.signal.aborted) return abortedResult();
        return { ok: false, error: "Could not reach the assistant. Check your connection." };
      }
      if (controller.signal.aborted) return abortedResult();
      if (response.status === 401 && attempt === 0) continue;
      let body: unknown = null;
      try {
        body = await response.json();
      } catch {
        // Non-JSON errors still have a status that can be explained.
      }
      if (controller.signal.aborted) return abortedResult();
      if (!response.ok) return { ok: false, error: messageForStatus(response.status, body, request.mode) };
      const reply = (body as { reply?: unknown } | null)?.reply;
      if (typeof reply !== "string" || !reply.trim()) {
        return { ok: false, error: "The assistant returned an empty answer." };
      }
      return { ok: true, reply: reply.trim() };
    }
    return { ok: false, error: "Your session could not be verified. Sign in again to use the assistant." };
  } finally {
    sources.forEach((source) => source.removeEventListener("abort", abort));
  }
}
