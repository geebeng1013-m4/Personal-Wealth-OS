/**
 * Shared types for the AI assistant.
 *
 * A "draft" is the assistant's reading of a plain-language request, already
 * resolved against the real WealthState — category labels turned into real ids,
 * tickers matched against the ones on file. A draft is never a record: it only
 * ever pre-fills a form, and the user still presses Save. Anything the model
 * named that could not be matched is listed in `unresolved` so the confirmation
 * card can say so rather than quietly dropping it.
 */

import type { TradeType } from "../../models";

export type AssistantMode = "help" | "fill";

export type AssistantRole = "user" | "assistant";

export interface AssistantMessage {
  id: string;
  role: AssistantRole;
  content: string;
  /** Epoch ms, for ordering. */
  at: number;
  /**
   * Which page visit this message was sent in. Only messages from the CURRENT
   * visit are sent back to the model; older ones stay on screen as history.
   * Absent on messages stored before this existed, which count as earlier.
   */
  visit?: string;
  /** Set on an assistant turn that failed, so it can be styled as an error. */
  failed?: boolean;
}

export interface LedgerDraft {
  kind: "ledger";
  type: "expense" | "income";
  amount: number;
  /** Resolved id, when the named category matched one on file. */
  categoryId?: string;
  /** What the resolved category (or the model's raw name) is called. */
  categoryLabel?: string;
  accountId?: string;
  accountName?: string;
  /** YYYY-MM-DD, always present — defaults to today when the model omitted it. */
  date: string;
  note: string;
  /** Field names the model supplied that could not be matched to real data. */
  unresolved: string[];
  /**
   * Figures the model produced that the user never actually stated, and which
   * were therefore left out. See figureAppearsIn in assistantActions.
   */
  dropped: string[];
}

export interface TradeDraft {
  kind: "trade";
  ticker: string;
  /** The ticker is not one already on file, so the form's "+ Custom" path is used. */
  isCustomTicker: boolean;
  tradeType: TradeType;
  platform: string;
  isCustomPlatform: boolean;
  date: string;
  amountMyr?: number;
  amountUsd?: number;
  priceUsd?: number;
  units?: number;
  feeMyr?: number;
  notes: string;
  unresolved: string[];
  /**
   * Figures the model produced that the user never actually stated, and which
   * were therefore left out. This is where an invented currency conversion
   * ends up — see figureAppearsIn in assistantActions.
   */
  dropped: string[];
}

export type AssistantDraft = LedgerDraft | TradeDraft;

/**
 * What became of one thing the user asked to record.
 *
 *   pending      — the request is in flight
 *   draft        — read successfully, waiting for the user to fill it in or discard
 *   filled       — the user pressed "Fill in the form"
 *   discarded    — the user pressed "Discard"
 *   expired      — a draft that was never acted on before the page was reloaded
 *   unrecognised — nothing recordable could be read from it
 *   failed       — the assistant could not be reached, or errored
 *
 * "expired" exists because a live draft is deliberately never persisted: an
 * offer to fill in a form is about right now, and finding yesterday's still
 * clickable is how the same expense gets entered twice. The entry survives as
 * history; only its ability to act does not.
 */
export type RecordStatus =
  | "pending"
  | "draft"
  | "filled"
  | "discarded"
  | "expired"
  | "unrecognised"
  | "failed";

/** One entry in the Record history. */
export interface RecordEntry {
  id: string;
  /** Epoch ms, for ordering and day grouping. */
  at: number;
  /** What the user actually typed. */
  said: string;
  status: RecordStatus;
  /** The live draft. Present only while status is "draft"; never persisted. */
  draft?: AssistantDraft;
  /** One line describing what was read. Kept after the draft is gone. */
  summary?: string;
  target?: "ledger" | "portfolio";
  /** Why nothing could be recorded, for unrecognised and failed entries. */
  reason?: string;
  unresolved?: string[];
  dropped?: string[];
}

export type DraftResult =
  | { ok: true; draft: AssistantDraft }
  | { ok: false; reason: string };
