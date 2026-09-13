/**
 * Pure request/response shaping for the AI-assistant proxy.
 *
 * Everything in this file is dependency-free and total: it never touches the
 * network, never reads a secret, and any input it cannot make sense of resolves
 * to a typed error rather than throwing. `assistant.ts` does the network and the
 * Cloud Functions wiring; it hands the request body here to be validated and
 * turned into an OpenRouter payload, and hands the upstream JSON back here to be
 * read. That seam is what the unit tests exercise.
 */

/** OpenRouter's OpenAI-compatible chat-completions endpoint. */
export const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";

/**
 * The model is fixed here and never read from the request. A client cannot ask
 * this proxy to bill a different (possibly paid) model.
 */
export const ASSISTANT_MODEL = "ling-3.0-flash-fin:free";

/** Caps on what one request may carry. Generous for a chat turn, hostile to abuse. */
export const MAX_MESSAGES = 20;
export const MAX_MESSAGE_CHARS = 4000;
export const MAX_TOTAL_CHARS = 16000;

/** Upstream generation limits. */
export const MAX_OUTPUT_TOKENS = 800;
export const TEMPERATURE = 0.3;

/**
 * System prompt for V1 (help / Q&A only). Deliberately small and factual —
 * mode B ("fill in this form") lands in a later task and will extend this.
 */
export const SYSTEM_PROMPT = [
  "You are the assistant inside WealthUp, a personal wealth web app.",
  "WealthUp helps one person track income, spending, cash flow, savings, a small",
  "ETF portfolio, budgets and financial goals. Its pages are: Overview (net worth",
  "and status), Ledger (income and expense entries), Portfolio (holdings and",
  "trades), Budget (fund allocation), Goals, Market (ETF research), Advisor,",
  "Review (monthly close), Rules, and two calculators (TVM and Investment Growth).",
  "",
  "Answer the user's question directly and briefly. Explain how to use a page or",
  "how a number is derived when asked. You cannot see the user's figures unless",
  "they are quoted in the conversation, so do not invent specific amounts. You",
  "cannot change any data yourself in this mode; if the user wants something",
  "recorded, tell them which page and which fields to use.",
  "This is not financial advice.",
].join("\n");

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface OpenRouterPayload {
  model: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  max_tokens: number;
  temperature: number;
  stream: false;
}

export type BuildResult =
  | { ok: true; payload: OpenRouterPayload }
  | { ok: false; status: number; error: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validate the request body and build the OpenRouter payload.
 *
 * Accepts `{ messages: ChatMessage[], mode?: "help" }`. The `system` role is
 * rejected from the client — this proxy owns the system prompt and prepends it.
 */
export function buildOpenRouterPayload(body: unknown): BuildResult {
  if (!isPlainObject(body)) {
    return { ok: false, status: 400, error: "Body must be a JSON object" };
  }

  const { messages, mode } = body as { messages?: unknown; mode?: unknown };

  if (mode !== undefined && mode !== "help") {
    return { ok: false, status: 400, error: "Unsupported mode" };
  }

  if (!Array.isArray(messages) || messages.length === 0) {
    return { ok: false, status: 400, error: "messages must be a non-empty array" };
  }
  if (messages.length > MAX_MESSAGES) {
    return { ok: false, status: 400, error: `At most ${MAX_MESSAGES} messages` };
  }

  const clean: ChatMessage[] = [];
  let totalChars = 0;

  for (const entry of messages) {
    if (!isPlainObject(entry)) {
      return { ok: false, status: 400, error: "Each message must be an object" };
    }
    const { role, content } = entry;
    if (role !== "user" && role !== "assistant") {
      return { ok: false, status: 400, error: `Unsupported message role: ${String(role)}` };
    }
    if (typeof content !== "string") {
      return { ok: false, status: 400, error: "message content must be a string" };
    }
    const trimmed = content.trim();
    if (trimmed.length === 0) {
      return { ok: false, status: 400, error: "message content must not be empty" };
    }
    if (trimmed.length > MAX_MESSAGE_CHARS) {
      return { ok: false, status: 400, error: `A message may not exceed ${MAX_MESSAGE_CHARS} characters` };
    }
    totalChars += trimmed.length;
    clean.push({ role, content: trimmed });
  }

  if (totalChars > MAX_TOTAL_CHARS) {
    return { ok: false, status: 400, error: "Conversation is too long; start a new one" };
  }
  if (clean[clean.length - 1].role !== "user") {
    return { ok: false, status: 400, error: "The last message must be from the user" };
  }

  return {
    ok: true,
    payload: {
      model: ASSISTANT_MODEL,
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...clean],
      max_tokens: MAX_OUTPUT_TOKENS,
      temperature: TEMPERATURE,
      stream: false,
    },
  };
}

export type ReplyResult =
  | { ok: true; reply: string }
  | { ok: false; error: string };

/**
 * Pull the assistant's text out of an OpenRouter chat-completions response.
 *
 * Total, like parseYahooQuote in api/quote.ts: any shape the upstream did not
 * promise — a renamed key, a missing level, an error object, an HTML page
 * parsed to a bare string — resolves to `{ ok: false }`, never to a fabricated
 * or partial reply.
 */
export function parseOpenRouterReply(json: unknown): ReplyResult {
  if (!isPlainObject(json)) return { ok: false, error: "Malformed response" };

  const upstreamError = (json as { error?: unknown }).error;
  if (isPlainObject(upstreamError) && typeof upstreamError.message === "string") {
    return { ok: false, error: upstreamError.message };
  }

  const choices = (json as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return { ok: false, error: "No completion returned" };
  }
  const message = isPlainObject(choices[0]) ? (choices[0] as Record<string, unknown>).message : undefined;
  const content = isPlainObject(message) ? message.content : undefined;
  if (typeof content !== "string" || content.trim().length === 0) {
    return { ok: false, error: "Empty completion" };
  }
  return { ok: true, reply: content.trim() };
}
