/**
 * Budget page — the bucket allocation matrix and its inline editor.
 *
 * Each bucket's amount and its share of the monthly plan come from
 * getBudgetSnapshot, the canonical model, so the bars always add up to what the
 * Dashboard's budget figures say.
 */

import type { WealthState } from "../models";
import { createId } from "../state";
import { money } from "../rules";
import { escapeHtml } from "../html";
import { leakInsightStrip } from "../components/leakInsightStrip";
import { pageHeader } from "../components/pageHeader";
import { getBudgetSnapshot } from "../budgetSummary";
import type { Navigate, RenderApp, Setter } from "./pageTypes";

export function bucketsTemplate(state: WealthState): string {
  // Bucket allocation facts come from the canonical budget read model.
  const bucketCards = getBudgetSnapshot(state).buckets.map((bucket) => {
    const index = bucket.index;
    const width = bucket.allocationRatio * 100;
    const cadence = bucket.cadence === "monthly" ? "Monthly" : "One-time";
    return `<article class="wu-card">
      <div class="wu-stack">
        <div class="wu-row wu-row--between">
          <span class="wu-label">${escapeHtml(bucket.name)}</span>
          <button class="wu-btn wu-btn--ghost wu-btn--sm edit-bucket" data-index="${index}" type="button">Edit</button>
        </div>
        <div class="wu-stack wu-stack--sm">
          <h3 class="t-heading">${escapeHtml(bucket.label)}</h3>
          <span class="wu-metric__value t-num">${money(bucket.amount)}</span>
          <div class="wu-bar"><span class="wu-bar__fill" style="width:${width}%"></span></div>
          <span class="wu-label--plain t-caption">${cadence} &middot; ${escapeHtml(bucket.note)}</span>
        </div>
        <div class="bucket-edit-form is-hidden" id="bucketEdit${index}">
          <form class="wu-stack bucketForm" data-index="${index}">
            <label class="wu-field-row"><span class="wu-field-row__label">Name</span><input class="wu-field" name="name" type="text" value="${escapeHtml(bucket.name)}"></label>
            <label class="wu-field-row"><span class="wu-field-row__label">Label</span><input class="wu-field" name="label" type="text" value="${escapeHtml(bucket.label)}"></label>
            <label class="wu-field-row"><span class="wu-field-row__label">Cadence</span><select class="wu-field" name="cadence"><option value="monthly"${bucket.cadence === "monthly" ? " selected" : ""}>Monthly</option><option value="one-time"${bucket.cadence === "one-time" ? " selected" : ""}>One-time</option></select></label>
            <label class="wu-field-row"><span class="wu-field-row__label">Amount MYR</span><input class="wu-field" name="amount" type="number" min="0" step="1" value="${bucket.amount}"></label>
            <label class="wu-field-row"><span class="wu-field-row__label">Note</span><textarea class="wu-field" name="note" rows="2">${escapeHtml(bucket.note)}</textarea></label>
            <div class="wu-row">
              <button class="wu-btn wu-btn--primary wu-btn--sm" type="submit">Save</button>
              <button class="wu-btn wu-btn--secondary wu-btn--sm cancel-bucket-edit" data-index="${index}" type="button">Cancel</button>
              <button class="wu-btn wu-btn--danger wu-btn--sm delete-bucket" data-index="${index}" type="button">Delete</button>
            </div>
          </form>
        </div>
      </div>
    </article>`;
  }).join("");

  const addBucketCard =
    `<button class="wu-add" id="addBucketBtn" type="button">` +
    `<span class="wu-add__plus" aria-hidden="true">+</span><span>Add Bucket</span></button>`;

  return `
    <div class="wu">
      ${pageHeader({
        eyebrow: "Capital Routing",
        title: "Monthly Fund Allocation Matrix",
        sub: "Give every ringgit a clear purpose to reduce emotional spending and impulsive investing.",
      })}
      ${leakInsightStrip(state, ["budget"], "Budget signal")}
      <div class="wu-grid wu-grid--3">
        ${bucketCards}
        ${addBucketCard}
      </div>
    </div>
  `;
}

export function bindBuckets(root: HTMLElement, state: WealthState, setState: Setter, navigate: Navigate | undefined, rerender: RenderApp): void {
  const doNavigate = navigate ?? ((page: string) => rerender(root, state, setState, page, navigate));

  root.querySelectorAll<HTMLButtonElement>(".edit-bucket").forEach((button) => {
    button.addEventListener("click", () => {
      const index = button.dataset.index;
      root.querySelector<HTMLElement>("#bucketEdit" + index)?.classList.toggle("is-hidden");
    });
  });

  root.querySelectorAll<HTMLButtonElement>(".cancel-bucket-edit").forEach((button) => {
    button.addEventListener("click", () => {
      const index = button.dataset.index;
      root.querySelector<HTMLElement>("#bucketEdit" + index)?.classList.add("is-hidden");
    });
  });

  root.querySelectorAll<HTMLFormElement>(".bucketForm").forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const index = Number(form.dataset.index);
      const data = new FormData(form);
      const buckets = [...state.buckets];
      buckets[index] = {
        ...buckets[index],
        name: String(data.get("name") ?? buckets[index].name),
        label: String(data.get("label") ?? buckets[index].label),
        cadence: String(data.get("cadence") ?? buckets[index].cadence) as "monthly" | "one-time",
        amount: Number(data.get("amount")) || 0,
        note: String(data.get("note") ?? buckets[index].note),
      };
      const next = { ...state, buckets };
      setState(next);
      doNavigate("buckets");
    });
  });

  // Delete bucket
  root.querySelectorAll<HTMLButtonElement>(".delete-bucket").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.index);
      if (!confirm("Delete this bucket?")) return;
      const buckets = state.buckets.filter((_, i) => i !== index);
      const next = { ...state, buckets };
      setState(next);
      doNavigate("buckets");
    });
  });

  // Add new bucket
  root.querySelector<HTMLElement>("#addBucketBtn")?.addEventListener("click", () => {
    const buckets = [...state.buckets, {
      id: createId("bucket"),
      name: "NEW BUCKET",
      label: "New Bucket",
      amount: 0,
      cadence: "monthly" as const,
      note: "",
    }];
    const next = { ...state, buckets };
    setState(next);
    doNavigate("buckets");
  });
}
