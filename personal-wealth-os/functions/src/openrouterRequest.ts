/**
 * Pure request/response shaping for the AI-assistant proxy.
 *
 * Everything in this file is dependency-free and total: it never touches the
 * network, never reads a secret, and any input it cannot make sense of resolves
 * to a typed error rather than throwing. `assistant.ts` does the network and the
 * Cloud Functions wiring; it hands the request body here to be validated and
 * turned into an OpenRouter payload, and hands the upstream JSON back here to be
 * read. That seam is what the unit tests exercise.
 *
 * Two modes share this path:
 *
 *   "help" — ordinary Q&A. The model answers in prose.
 *   "fill" — the user described something to record. The model answers with one
 *            JSON action object, which the BROWSER parses and validates against
 *            the live WealthState (see src/components/assistant/). The server
 *            deliberately does not parse it: only the client knows the real
 *            category / account / ticker ids, and keeping the action schema on
 *            one side avoids two copies drifting apart.
 *
 * The system prompt for each mode lives here, server-side, so a client cannot
 * replace it. The `context` string comes from the client (it is the only side
 * that can see the user's own vocabulary and figures) and is length-capped and
 * carried as a separate system message.
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
/**
 * The client-supplied context (today's date, the user's category/account/ticker
 * names, and — only when they opt in — a small figures summary). Capped
 * separately from the conversation so a large context cannot crowd it out.
 */
export const MAX_CONTEXT_CHARS = 4000;

/**
 * Upstream generation limits.
 *
 * This model reasons before answering and bills that reasoning against the same
 * budget, so the ceiling has to cover thinking AND the answer. At 800 a trade
 * request ("bought 500 usd of VOO at 520.50, fee 3") spent the whole budget
 * reasoning about exchange rates and returned an EMPTY completion. Fill mode
 * gets the larger budget because its reasoning is the longer of the two.
 */
export const MAX_OUTPUT_TOKENS = 1200;
export const MAX_OUTPUT_TOKENS_FILL = 2400;
/** Prose wants a little warmth; a JSON action wants determinism. */
export const TEMPERATURE_HELP = 0.3;
export const TEMPERATURE_FILL = 0.1;

export type AssistantMode = "help" | "fill";

/**
 * System prompt for ordinary Q&A.
 */
export const SYSTEM_PROMPT = [
  "You are the assistant inside WealthUp, a personal wealth web app for young people",
  "in Malaysia. WealthUp helps a person track income, spending, cash flow, savings, an",
  "ETF portfolio, budgets and financial goals. Its pages are: Overview (net worth and",
  "status), Ledger (income and expense entries), Portfolio (holdings and trades),",
  "Budget (fund allocation), Goals, Market (ETF research), Advisor, Review (monthly",
  "close), Rules, and two calculators (TVM and Investment Growth).",
  "",
  "HOW TO ANSWER",
  "- Reply in the same language the user writes in. Be direct and brief.",
  "- Before answering, check the question against the WEALTHUP PRINCIPLES below, then",
  "  against the user's own rules and goals if the context provides them. Only then add",
  "  general personal-finance knowledge.",
  "- Priority: WealthUp principles, then the user's own rules, then general knowledge.",
  "  If a piece of general advice would break a principle, do not give it. Say briefly",
  "  which principle applies, then offer an alternative that follows the principles.",
  "- Use only figures given to you in the conversation or the context. Never invent",
  "  amounts. When no figures are provided, answer in general terms and mention that",
  "  the user can tick \"Share my figures\" at the bottom of this assistant panel for an",
  "  answer about their own numbers. That checkbox is the only place to turn it on. Always",
  "  write its name exactly as \"Share my figures\", in English, even in a Chinese reply,",
  "  because that is the label on screen.",
  "- You cannot change any data. If the user wants something recorded, tell them to use",
  "  the Record tab.",
  "- When you give advice, end with a short note, in the user's language, that it is",
  "  not financial advice.",
  "",
  "WEALTHUP PRINCIPLES",
  "1. Budget. The split is personal, but once set it is a rule, not a guideline. The",
  "   ledger shows which category ran over so it can be brought back within budget.",
  "   Overspending in one category is NEVER covered by taking money from another",
  "   category, from savings, from investments or from the emergency fund. Cut back",
  "   within that same category this month; if it keeps happening, adjust the budget",
  "   split from next month.",
  "2. Emergency fund comes first. Default split: 50% needs, 30% wants (a wishlist is",
  "   part of wants), 20% savings. Until the emergency fund is full, the whole 20% goes",
  "   into it and nothing is invested. Once it is full, that 20% is invested.",
  "   The target is 3 to 6 months of ESSENTIAL expenses (needs only); 6 months by",
  "   default. Keep it in a money market fund. Use it ONLY for real emergencies such as",
  "   an accident, a medical emergency or losing a job. It is never for everyday",
  "   spending such as food, bills, shopping or travel. Its purpose is to avoid being",
  "   forced to sell investments and break compounding. If it is used, pause investing",
  "   and refill it first.",
  "3. Debt. Pay off high-interest debt such as credit cards before investing.",
  "   Low-interest loans such as a car or home loan can be repaid while investing.",
  "4. Investing. Mainly broad market-cap ETFs held for the long term. About 8% a year",
  "   is a planning assumption, never a promise. Sell only when a financial goal is",
  "   reached (for example a car, a home, retirement), never to cover everyday spending.",
  "   Do not buy or sell because of news, charts or short-term moves, and do not hold",
  "   back new money to wait for a dip or a pullback: invest it on schedule. Rebalance by",
  "   directing next month's new money into what is underweight; sell to rebalance only",
  "   if drift is above 8% and new money cannot correct it within a year.",
  "5. Goals. Decide where a goal's money goes when the goal is set: a goal 3 years away",
  "   or less goes in a money market fund; a longer goal may use ETFs for higher",
  "   expected returns. Take the money out only when the goal is reached. A new purpose",
  "   gets its own bucket and its own share of the budget, adjusted to what the person",
  "   is comfortable with; money already set aside for something else is not raided.",
  "6. Limits. Never recommend individual stocks, crypto or specific products. Never",
  "   promise returns. Never suggest timing the market, and never say whether now is a",
  "   good or bad time to buy or sell. If the user already holds",
  "   individual stocks, you may explain judging them on several years of company",
  "   results rather than news or charts, without naming anything to buy. Do not",
  "   recommend keeping a bear-market reserve. When the context gives the user's",
  "   financial goals, frame your advice around those goals.",
].join("\n");

/**
 * System prompt for turning a plain-language request into one action object.
 *
 * The schema is stated in full because this model is not asked for a structured
 * response format — free models vary in whether they support one, and a
 * rejected request is worse than a prompt-guided one. The browser parses the
 * reply leniently (fences stripped, first object taken) and validates every
 * field, so a malformed answer degrades to "I could not read that", never to a
 * wrong record.
 */
export const FILL_SYSTEM_PROMPT = [
  "You turn a plain-language request into ONE action object for WealthUp, a",
  "personal wealth app.",
  "",
  "Reply with a single JSON object and nothing else. No prose, no explanation,",
  "no markdown code fences.",
  "",
  "Supported actions:",
  "",
  "1. A ledger entry — money spent or received:",
  '{"action":"ledger.entry","type":"expense"|"income","amount":NUMBER,"category":"CATEGORY LABEL","account":"ACCOUNT NAME","date":"YYYY-MM-DD","note":"SHORT TEXT"}',
  "",
  "2. A portfolio trade — buying or selling a holding:",
  '{"action":"portfolio.trade","ticker":"SYMBOL","tradeType":"DCA"|"Dip Buy"|"Manual Buy"|"Sell","platform":"BROKER","date":"YYYY-MM-DD","amountMyr":NUMBER,"amountUsd":NUMBER,"priceUsd":NUMBER,"units":NUMBER,"feeMyr":NUMBER,"notes":"SHORT TEXT"}',
  "",
  "3. Nothing recordable:",
  '{"action":"none","reason":"ONE SHORT SENTENCE saying what is missing or unclear"}',
  "",
  "Rules:",
  "- Include only the fields you are confident about. Omit a field rather than guess it.",
  "- Every number must be a plain positive number: no currency symbols, no thousands separators, no quotes.",
  "- The context lists the user's real categories, accounts, tickers and platforms. Copy a name from those lists exactly. If nothing fits, omit the field.",
  "- The context gives today's date. Resolve 'yesterday', 'last Friday', 'this morning' against it and always output an absolute YYYY-MM-DD date.",
  "- Ledger amounts are in MYR unless the user clearly says otherwise.",
  "- 'type' is 'expense' for money going out and 'income' for money coming in.",
  "- NEVER convert between currencies and never estimate an exchange rate. If the user gave a USD amount and no MYR amount, fill amountUsd and omit amountMyr.",
  "- NEVER calculate a figure the user did not state. Do not divide an amount by a price to produce units. Omit it instead.",
  "- If the user asked a question rather than describing something to record, use action 'none'.",
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
  | { ok: true; payload: OpenRouterPayload; mode: AssistantMode }
  | { ok: false; status: number; error: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validate the request body and build the OpenRouter payload.
 *
 * Accepts `{ messages: ChatMessage[], mode?: "help" | "fill", context?: string }`.
 * The `system` role is rejected from the client — this proxy owns the system
 * prompt and prepends it.
 */
export function buildOpenRouterPayload(body: unknown): BuildResult {
  if (!isPlainObject(body)) {
    return { ok: false, status: 400, error: "Body must be a JSON object" };
  }

  const { messages, mode: rawMode, context } = body as {
    messages?: unknown;
    mode?: unknown;
    context?: unknown;
  };

  if (rawMode !== undefined && rawMode !== "help" && rawMode !== "fill") {
    return { ok: false, status: 400, error: "Unsupported mode" };
  }
  const mode: AssistantMode = rawMode === "fill" ? "fill" : "help";

  if (context !== undefined) {
    if (typeof context !== "string") {
      return { ok: false, status: 400, error: "context must be a string" };
    }
    if (context.length > MAX_CONTEXT_CHARS) {
      return { ok: false, status: 400, error: `context may not exceed ${MAX_CONTEXT_CHARS} characters` };
    }
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

  const system = mode === "fill" ? FILL_SYSTEM_PROMPT : SYSTEM_PROMPT;
  const contextText = typeof context === "string" ? context.trim() : "";
  const preamble: OpenRouterPayload["messages"] = [{ role: "system", content: system }];
  if (contextText.length > 0) {
    preamble.push({ role: "system", content: `Context:\n${contextText}` });
  }

  return {
    ok: true,
    mode,
    payload: {
      model: ASSISTANT_MODEL,
      messages: [...preamble, ...clean],
      max_tokens: mode === "fill" ? MAX_OUTPUT_TOKENS_FILL : MAX_OUTPUT_TOKENS,
      temperature: mode === "fill" ? TEMPERATURE_FILL : TEMPERATURE_HELP,
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

/**
 * Why OpenRouter refused a request with 429.
 *
 *   daily — the free tier's per-day request allowance is used up. It comes back
 *           at a fixed reset time, usually hours away, for every user at once:
 *           the whole app shares one key.
 *   burst — a short-term limit. Trying again in a moment is the right advice.
 *
 * The two need different words. Telling someone to "try again shortly" when the
 * answer is "tomorrow morning" was what users actually saw the first time the
 * daily allowance ran out.
 */
export type UpstreamLimit =
  | { kind: "daily"; resetAt: number | null }
  | { kind: "burst" };

/** A reset time as epoch ms, or null. Accepts seconds or ms; rejects the absurd. */
function toResetAt(value: unknown, now: number): number | null {
  const n = typeof value === "string" ? Number(value) : typeof value === "number" ? value : Number.NaN;
  if (!Number.isFinite(n) || n <= 0) return null;
  const ms = n < 1e12 ? n * 1000 : n;
  // A daily reset is never in the past and never more than two days out.
  if (ms < now - 60_000 || ms > now + 2 * 24 * 60 * 60 * 1000) return null;
  return ms;
}

/**
 * Read an OpenRouter 429 body (and its X-RateLimit-Reset header).
 *
 * Total, like the other readers here: any shape it does not recognise is treated
 * as a burst limit, which is the conservative reading — it only ever produces the
 * old "try again shortly" wording, never a wrong promise about tomorrow.
 */
export function readUpstreamLimit(json: unknown, resetHeader: string | null, now: number): UpstreamLimit {
  const error = isPlainObject(json) ? (json as { error?: unknown }).error : undefined;
  if (!isPlainObject(error)) return { kind: "burst" };

  const message = typeof error.message === "string" ? error.message : "";
  const metadata = isPlainObject(error.metadata) ? error.metadata : {};
  const source = typeof metadata.limit_source === "string" ? metadata.limit_source : "";

  const daily = /per[-\s]?day/i.test(message) || /daily/i.test(source);
  if (!daily) return { kind: "burst" };

  const metaHeaders = isPlainObject(metadata.headers) ? metadata.headers : {};
  const resetAt = toResetAt(resetHeader, now) ?? toResetAt(metaHeaders["X-RateLimit-Reset"], now);
  return { kind: "daily", resetAt };
}
