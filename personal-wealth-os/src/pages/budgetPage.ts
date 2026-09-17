/**
 * Budget page — where this month's money went, and the rules that sent it.
 *
 * One editable list, not two. Each layer of the allocation plan states its
 * rule, what it received this month, and opens an inline editor for the rule
 * itself. The monthly bucket cards this page used to carry were a second way
 * to say the same thing, and the two could disagree the moment either was
 * edited; the plan is now the only place a monthly figure is set.
 *
 * `state.buckets` keeps the one-time entries (the Opportunity reserve, which is
 * deployed by its own drawdown rules and never flows through the waterfall) and
 * is kept in step with the plan for the monthly ones, so everything still
 * reading buckets — the Assistant's context, most of all — sees what the user
 * sees.
 *
 * Every figure comes from getBudgetSnapshot, the canonical model.
 */

import type { AllocationStep, AllocationStepKind, WealthState } from "../models";
import { bucketsFromPlan, createId } from "../state";
import { money } from "../rules";
import { escapeHtml } from "../html";
import { normalizePercentSteps } from "../allocation";
import { leakInsightStrip } from "../components/leakInsightStrip";
import { pageHeader } from "../components/pageHeader";
import { allocationPanel } from "../components/allocationPanel";
import { getBudgetSnapshot } from "../budgetSummary";
import type { Navigate, RenderApp, Setter } from "./pageTypes";

function isStepKind(value: string): value is AllocationStepKind {
  return value === "fill" || value === "pct" || value === "gross";
}

export function bucketsTemplate(state: WealthState): string {
  // One snapshot for the whole page: the waterfall and the one-time cards must
  // never be built from two different reads of the same state.
  const budget = getBudgetSnapshot(state);
  const plan = state.allocation;

  // One-time buckets sit outside the waterfall, so they keep the card editor.
  const oneTimeCards = budget.buckets
    .filter((bucket) => bucket.cadence === "one-time")
    .map((bucket) => {
      const index = bucket.index;
      return `<article class="wu-card">
      <div class="wu-stack">
        <div class="wu-row wu-row--between">
          <span class="wu-label">${escapeHtml(bucket.name)}</span>
          <button class="wu-btn wu-btn--ghost wu-btn--sm edit-bucket" data-index="${index}" type="button">Edit</button>
        </div>
        <div class="wu-stack wu-stack--sm">
          <h3 class="t-heading">${escapeHtml(bucket.label)}</h3>
          <span class="wu-metric__value t-num">${money(bucket.amount)}</span>
          <span class="wu-label--plain t-caption">One-time &middot; ${escapeHtml(bucket.note)}</span>
        </div>
        <div class="bucket-edit-form is-hidden" id="bucketEdit${index}">
          <form class="wu-stack bucketForm" data-index="${index}">
            <label class="wu-field-row"><span class="wu-field-row__label">Name</span><input class="wu-field" name="name" type="text" value="${escapeHtml(bucket.name)}"></label>
            <label class="wu-field-row"><span class="wu-field-row__label">Label</span><input class="wu-field" name="label" type="text" value="${escapeHtml(bucket.label)}"></label>
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

  const oneTimeSection = oneTimeCards
    ? `<div class="wu-stack wu-stack--sm" style="margin-top:var(--space-5)">
        <span class="wu-label">Set aside, not routed</span>
        <span class="wu-label--plain t-caption">Deployed by its own rules when the market falls, so it never flows through the layers above.</span>
      </div>
      <div class="wu-grid wu-grid--3">${oneTimeCards}</div>`
    : "";

  return `
    <div class="wu">
      ${pageHeader({
        eyebrow: "Capital Routing",
        title: "Budget",
        sub: "Where this month's money went, and the rules that sent it.",
      })}
      ${leakInsightStrip(state, ["budget"], "Budget signal")}
      ${allocationPanel(budget, plan)}
      ${oneTimeSection}
    </div>
  `;
}

export function bindBuckets(root: HTMLElement, state: WealthState, setState: Setter, navigate: Navigate | undefined, rerender: RenderApp): void {
  const doNavigate = navigate ?? ((page: string) => rerender(root, state, setState, page, navigate));

  /**
   * Write a new plan. The monthly buckets are rewritten from it in the same
   * breath, so the two can never drift into disagreeing about a figure.
   */
  const savePlan = (steps: AllocationStep[], overflowStepId = state.allocation.overflowStepId): void => {
    const allocation = {
      ...state.allocation,
      steps,
      overflowStepId: steps.some((step) => step.id === overflowStepId)
        ? overflowStepId
        : steps[steps.length - 1]?.id,
    };
    setState({ ...state, allocation, buckets: bucketsFromPlan(allocation, state.buckets) });
    doNavigate("buckets");
  };

  // --- Layers ---------------------------------------------------------------

  root.querySelectorAll<HTMLButtonElement>(".edit-layer").forEach((button) => {
    button.addEventListener("click", () => {
      root.querySelector<HTMLElement>("#layerEdit" + button.dataset.index)?.classList.toggle("is-hidden");
    });
  });

  root.querySelectorAll<HTMLButtonElement>(".cancel-layer-edit").forEach((button) => {
    button.addEventListener("click", () => {
      root.querySelector<HTMLElement>("#layerEdit" + button.dataset.index)?.classList.add("is-hidden");
    });
  });

  root.querySelectorAll<HTMLFormElement>(".layerForm").forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const index = Number(form.dataset.index);
      const data = new FormData(form);
      const steps = [...state.allocation.steps];
      const current = steps[index];
      if (!current) return;
      const kind = String(data.get("kind") ?? current.kind);
      const note = String(data.get("note") ?? current.note ?? "").trim();
      steps[index] = {
        ...current,
        name: String(data.get("name") ?? current.name),
        kind: isStepKind(kind) ? kind : current.kind,
        value: Math.max(0, Number(data.get("value")) || 0),
        ...(note ? { note } : {}),
      };
      if (!note) delete steps[index].note;
      savePlan(steps);
    });
  });

  // The field below the rule means ringgit for one kind and per cent for the
  // others, so it renames itself as the rule changes rather than after saving.
  root.querySelectorAll<HTMLFormElement>(".layerForm").forEach((form) => {
    const kind = form.querySelector<HTMLSelectElement>("select[name=kind]");
    const label = form.querySelector<HTMLElement>(".js-value-label");
    const value = form.querySelector<HTMLInputElement>("input[name=value]");
    kind?.addEventListener("change", () => {
      const isFill = kind.value === "fill";
      if (label) label.textContent = isFill ? "Amount MYR" : "Share %";
      if (value) value.step = isFill ? "1" : "0.1";
    });
  });

  root.querySelectorAll<HTMLButtonElement>(".move-layer").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.index);
      const target = button.dataset.dir === "up" ? index - 1 : index + 1;
      const steps = [...state.allocation.steps];
      if (target < 0 || target >= steps.length) return;
      [steps[index], steps[target]] = [steps[target], steps[index]];
      savePlan(steps);
    });
  });

  root.querySelectorAll<HTMLButtonElement>(".delete-layer").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.index);
      const step = state.allocation.steps[index];
      if (!step) return;
      if (!confirm(`Delete the ${step.name} layer? Money that reached it will flow to the layers below.`)) return;
      savePlan(state.allocation.steps.filter((_, i) => i !== index));
    });
  });

  root.querySelector<HTMLElement>("#addLayerBtn")?.addEventListener("click", () => {
    // A new layer starts claiming nothing, so adding one cannot quietly change
    // where this month's money already went.
    savePlan([...state.allocation.steps, {
      id: createId("layer"),
      name: "New layer",
      kind: "fill" as const,
      value: 0,
      note: "",
    }]);
  });

  root.querySelector<HTMLSelectElement>("#overflowSelect")?.addEventListener("change", (event) => {
    savePlan([...state.allocation.steps], (event.target as HTMLSelectElement).value);
  });

  root.querySelector<HTMLElement>("#normalizeLayersBtn")?.addEventListener("click", () => {
    savePlan(normalizePercentSteps(state.allocation).steps);
  });

  // --- One-time buckets -----------------------------------------------------

  root.querySelectorAll<HTMLButtonElement>(".edit-bucket").forEach((button) => {
    button.addEventListener("click", () => {
      root.querySelector<HTMLElement>("#bucketEdit" + button.dataset.index)?.classList.toggle("is-hidden");
    });
  });

  root.querySelectorAll<HTMLButtonElement>(".cancel-bucket-edit").forEach((button) => {
    button.addEventListener("click", () => {
      root.querySelector<HTMLElement>("#bucketEdit" + button.dataset.index)?.classList.add("is-hidden");
    });
  });

  root.querySelectorAll<HTMLFormElement>(".bucketForm").forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const index = Number(form.dataset.index);
      const data = new FormData(form);
      const buckets = [...state.buckets];
      if (!buckets[index]) return;
      buckets[index] = {
        ...buckets[index],
        name: String(data.get("name") ?? buckets[index].name),
        label: String(data.get("label") ?? buckets[index].label),
        amount: Number(data.get("amount")) || 0,
        note: String(data.get("note") ?? buckets[index].note),
      };
      setState({ ...state, buckets });
      doNavigate("buckets");
    });
  });

  root.querySelectorAll<HTMLButtonElement>(".delete-bucket").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.index);
      if (!confirm("Delete this bucket?")) return;
      setState({ ...state, buckets: state.buckets.filter((_, i) => i !== index) });
      doNavigate("buckets");
    });
  });
}
