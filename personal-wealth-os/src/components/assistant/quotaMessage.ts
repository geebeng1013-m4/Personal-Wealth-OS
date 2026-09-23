/**
 * What to tell someone when their daily assistant allowance is used up.
 *
 * The allowance is this account's own: a fixed number of Ask and Record turns
 * a day, counted server-side (functions/src/quota.ts). It comes back at local
 * midnight — hours away, not seconds — so "try again shortly" would send people
 * straight back into the same refusal.
 *
 * The reset arrives from the server as an absolute time, so it is shown in the
 * reader's own clock rather than as the instant it actually is.
 *
 * Pure: `now` and the formatting locale are passed in, so it is testable.
 */

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** "8:00 am" — hour and minute in the reader's locale. */
function clock(date: Date, locale?: string): string {
  return date.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
}

/** When it comes back, in words: "at 8:00 am", "tomorrow at 8:00 am", "on 17 Sep at 8:00 am". */
export function describeReset(resetAt: number, now: Date, locale?: string): string {
  const reset = new Date(resetAt);
  const days = Math.round((startOfDay(reset) - startOfDay(now)) / 86_400_000);
  if (days <= 0) return `later today at ${clock(reset, locale)}`;
  if (days === 1) return `tomorrow at ${clock(reset, locale)}`;
  const date = reset.toLocaleDateString(locale, { day: "numeric", month: "short" });
  return `on ${date} at ${clock(reset, locale)}`;
}

/**
 * The full sentence for the panel.
 *
 * Says what happened in plain terms (an allowance, not an error the user
 * caused), when it comes back, and that nothing is lost in the meantime.
 */
export function dailyLimitMessage(
  retryAt: unknown,
  now: Date,
  locale?: string,
  mode?: "help" | "fill",
): string {
  // Which allowance ran out matters: the other one is still there, and being
  // told "the assistant" is done when recording still works would be wrong.
  const what = mode === "fill" ? "Record" : mode === "help" ? "Ask" : "assistant";
  const lead = `You have used today's ${what} allowance.`;
  const valid = typeof retryAt === "number" && Number.isFinite(retryAt) && retryAt > now.getTime() - 60_000;
  const when = valid
    ? `It will be available again ${describeReset(retryAt, now, locale)}.`
    : "It will be available again tomorrow.";
  const rest = mode === "fill"
    ? "Ask still works, and you can record anything by hand as usual."
    : mode === "help"
      ? "Record still works, and the rest of WealthUp is unaffected."
      : "The rest of WealthUp works as usual.";
  return `${lead} ${when} ${rest}`;
}
