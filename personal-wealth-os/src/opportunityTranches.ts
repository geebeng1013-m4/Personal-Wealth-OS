import type { OpportunityTranche, WealthState } from "./models";
import { syncPlanningRules } from "./financialRules";

/** Edit the plan without rewriting deployed amounts or reserve usage. */
export function updateOpportunityTranches(
  state: WealthState,
  entries: readonly { drawdown: string; amount: string }[],
): { ok: true; state: WealthState } | { ok: false; error: string } {
  const { opportunity } = state;
  if (!entries.length || entries.length !== opportunity.tranches.length) return { ok: false, error: "No matching dip-buy steps are available to edit." };
  const totalCents = Math.round(opportunity.total * 100);
  const usedCents = Math.round(opportunity.used * 100);
  if (!Number.isSafeInteger(totalCents) || totalCents <= 0 || !Number.isSafeInteger(usedCents) || usedCents < 0 || usedCents > totalCents) {
    return { ok: false, error: "Set a valid opportunity reserve and used amount before editing its steps." };
  }
  const tranches: OpportunityTranche[] = [];
  const drops = new Set<number>();
  let plannedCents = 0;
  let pendingCents = 0;
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    const existing = opportunity.tranches[index];
    const drawdown = Number(entry.drawdown);
    const amount = Number(entry.amount);
    const cents = Math.round(amount * 100);
    if (!/^[0-9]+([.][0-9]{1,2})?$/.test(entry.drawdown) || !Number.isFinite(drawdown) || drawdown <= 0 || drawdown > 100) {
      return { ok: false, error: `Step ${index + 1}: enter a drawdown greater than 0 and at most 100%, with up to two decimals.` };
    }
    if (!/^[0-9]+([.][0-9]{1,2})?$/.test(entry.amount) || !Number.isSafeInteger(cents) || cents <= 0) {
      return { ok: false, error: `Step ${index + 1}: enter a positive MYR amount with up to two decimals.` };
    }
    if (existing.deployed && (drawdown !== existing.drawdown || amount !== existing.amount)) {
      return { ok: false, error: "Deployed steps are locked. Their trigger and invested amount cannot be changed here." };
    }
    if (drops.has(drawdown)) return { ok: false, error: "Each step must have a different drawdown trigger." };
    drops.add(drawdown);
    plannedCents += cents;
    if (!existing.deployed) pendingCents += cents;
    tranches.push(existing.deployed ? { ...existing } : { ...existing, drawdown, amount: cents / 100, percent: cents / totalCents });
  }
  if (!Number.isSafeInteger(plannedCents) || plannedCents > totalCents) return { ok: false, error: "The combined step amounts cannot exceed the opportunity reserve." };
  if (pendingCents > totalCents - usedCents) return { ok: false, error: "Undeployed step amounts cannot exceed the remaining reserve after money already used." };
  const next = { ...state, opportunity: { ...opportunity, tranches: tranches.sort((a, b) => a.drawdown - b.drawdown) } };
  return { ok: true, state: { ...next, financialRules: syncPlanningRules(next, ["opportunity-reserve-deployment"]) } };
}
