/**
 * Budget page — where this month's money went, and the rules that sent it.
 *
 * One editable list, not two. Each layer of the allocation plan states its
 * rule, what it received this month, and opens an editor for the rule itself.
 * The monthly bucket cards this page used to carry were a second way to say the
 * same thing, and the two could disagree the moment either was edited; the plan
 * is now the only place a monthly figure is set.
 *
 * `state.buckets` keeps the one-time entries (the Opportunity reserve, which is
 * deployed by its own drawdown rules and never flows through the waterfall) and
 * is kept in step with the plan for the monthly ones, so everything still
 * reading buckets — the Assistant's context, most of all — sees what the user
 * sees.
 *
 * Every figure comes from getBudgetSnapshot, the canonical model. The layout
 * lives in components/allocationPanel.ts (T-6a).
 */

import type { AllocationStep, AllocationStepKind, WealthState } from "../models";
import { bucketsFromPlan, createId, parseExpectedIncomeInput, withExpectedIncome } from "../state";
import { allocateMonth, normalizePercentSteps } from "../allocation";
import { pageHeader } from "../components/pageHeader";
import { budgetContent, type BudgetView } from "../components/allocationPanel";
import { getBudgetSnapshot } from "../budgetSummary";
import type { Navigate, RenderApp, Setter } from "./pageTypes";

/** Which layer, bucket or picker is open — kept across re-renders. */
const view: BudgetView = { openLayer: null, openBucket: null, overflowOpen: false, planMonth: 0, aheadDraft: null };

function isStepKind(value: string): value is AllocationStepKind {
  return value === "fill" || value === "pct" || value === "gross";
}

/** The page's figures: the budget snapshot, plus the plan an unsaved income would give. */
function budgetBody(state: WealthState): string {
  // One snapshot for the whole page: the layers and the one-time rows must
  // never be built from two different reads of the same state.
  const budget = getBudgetSnapshot(state);
  const planning = budget.allocation.ahead[view.planMonth];
  const draftAmount = view.aheadDraft?.monthKey === planning.monthKey ? parseExpectedIncomeInput(view.aheadDraft.text) : null;
  const draftResult = draftAmount === null ? null : allocateMonth(state.allocation, draftAmount);
  return budgetContent(budget, state.allocation, view, draftResult);
}

export function bucketsTemplate(state: WealthState): string {
  return `
    <div class="wu wu-budget-page">
      ${pageHeader({
        eyebrow: "Capital Routing",
        title: "Budget",
        sub: "How your income is allocated by your rules, compared with your plan.",
        actions: `<button class="wu-btn wu-btn--secondary wu-btn--sm add-layer" type="button">+ Add layer</button>`,
      })}
      <div class="wu-dash">
        ${budgetBody(state)}
      </div>
    </div>
  `;
}

export function bindBuckets(root: HTMLElement, state: WealthState, setState: Setter, navigate: Navigate | undefined, rerender: RenderApp): void {
  /** Re-render in place, keeping the reader where they were; save first when there is a change. */
  const repaint = (next?: WealthState): void => {
    const scrollPosition = { x: window.scrollX, y: window.scrollY, documentY: document.scrollingElement?.scrollTop ?? 0 };
    if (next) setState(next);
    rerender(root, next ?? state, setState, "buckets", navigate);
    const restore = () => {
      window.scrollTo(scrollPosition.x, scrollPosition.y);
      document.scrollingElement?.scrollTo(scrollPosition.x, scrollPosition.documentY);
    };
    restore();
    requestAnimationFrame(restore);
  };

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
    repaint({ ...state, allocation, buckets: bucketsFromPlan(allocation, state.buckets) });
  };

  // --- Opening and closing rows --------------------------------------------
  root.querySelectorAll<HTMLButtonElement>(".layer-row").forEach((button) => button.addEventListener("click", () => {
    const index = Number(button.dataset.index);
    view.openLayer = view.openLayer === index ? null : index;
    view.openBucket = null;
    view.overflowOpen = false;
    repaint();
  }));
  root.querySelectorAll<HTMLButtonElement>(".bucket-row").forEach((button) => button.addEventListener("click", () => {
    const index = Number(button.dataset.index);
    view.openBucket = view.openBucket === index ? null : index;
    view.openLayer = null;
    view.overflowOpen = false;
    repaint();
  }));
  root.querySelectorAll<HTMLButtonElement>(".overflow-row").forEach((button) => button.addEventListener("click", () => {
    view.overflowOpen = !view.overflowOpen;
    view.openLayer = null;
    view.openBucket = null;
    repaint();
  }));
  root.querySelectorAll<HTMLButtonElement>(".budget-close").forEach((button) => button.addEventListener("click", () => {
    view.openLayer = null;
    view.openBucket = null;
    repaint();
  }));

  // --- Plan ahead -----------------------------------------------------------

  root.querySelectorAll<HTMLButtonElement>(".plan-month").forEach((button) => button.addEventListener("click", () => {
    view.planMonth = button.dataset.month === "1" ? 1 : 0;
    repaint();
  }));

  const aheadForm = root.querySelector<HTMLFormElement>("#planAheadForm");
  const aheadInput = root.querySelector<HTMLInputElement>("#planAheadIncome");
  const aheadHint = root.querySelector<HTMLElement>("#planAheadHint");
  const showAheadError = (message: string | null): void => {
    aheadInput?.setAttribute("aria-invalid", String(message !== null));
    if (aheadHint && message !== null) aheadHint.textContent = message;
  };
  const invalidAmount = "Enter an amount of 0 or more.";

  /**
   * Put new figures into what is already on screen. Typing an income changes
   * what each layer is planned to get, never which layers there are, so only
   * the cells marked data-live are replaced — the rows, and a layer editor open
   * among them with whatever is typed in it, stay put.
   */
  const refreshPlanFigures = (): void => {
    const fresh = document.createElement("div");
    fresh.innerHTML = budgetBody(state);
    fresh.querySelectorAll<HTMLElement>("[data-live]").forEach((cell) => {
      const shown = root.querySelector<HTMLElement>(`[data-live="${cell.dataset.live}"]`);
      if (shown) shown.innerHTML = cell.innerHTML;
    });
  };

  // The figures follow the field as it is typed; only Save writes anything.
  aheadInput?.addEventListener("input", () => {
    view.aheadDraft = { monthKey: aheadForm?.dataset.month ?? "", text: aheadInput.value };
    const amount = parseExpectedIncomeInput(aheadInput.value);
    if (amount === null) {
      showAheadError(invalidAmount);
      return;
    }
    showAheadError(null);
    if (aheadHint) aheadHint.textContent = "Not saved yet.";
    refreshPlanFigures();
  });

  aheadForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const amount = parseExpectedIncomeInput(aheadInput?.value ?? "");
    if (amount === null) {
      showAheadError(invalidAmount);
      aheadInput?.focus();
      return;
    }
    view.aheadDraft = null;
    repaint(withExpectedIncome(state, aheadForm.dataset.month ?? "", amount));
  });

  // --- Layers ---------------------------------------------------------------

  // The rule is picked from three options; the value field beneath it means
  // ringgit for one and per cent for the others, so it renames itself as the
  // rule changes rather than after saving.
  root.querySelectorAll<HTMLFormElement>(".layerForm").forEach((form) => {
    const kindInput = form.querySelector<HTMLInputElement>("input[name=kind]");
    const label = form.querySelector<HTMLElement>(".js-value-label");
    const value = form.querySelector<HTMLInputElement>("input[name=value]");
    form.querySelectorAll<HTMLButtonElement>(".layer-kind").forEach((button) => button.addEventListener("click", () => {
      const kind = button.dataset.kind ?? "fill";
      if (kindInput) kindInput.value = kind;
      form.querySelectorAll<HTMLButtonElement>(".layer-kind").forEach((other) => {
        const active = other === button;
        other.classList.toggle("is-active", active);
        other.setAttribute("aria-pressed", String(active));
      });
      const isFill = kind === "fill";
      if (label) label.textContent = isFill ? "Amount MYR" : "Share %";
      if (value) value.step = isFill ? "1" : "0.1";
    }));

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
      view.openLayer = null;
      savePlan(steps);
    });
  });

  root.querySelectorAll<HTMLButtonElement>(".move-layer").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.index);
      const target = button.dataset.dir === "up" ? index - 1 : index + 1;
      const steps = [...state.allocation.steps];
      if (target < 0 || target >= steps.length) return;
      [steps[index], steps[target]] = [steps[target], steps[index]];
      // The editor follows the layer it was editing.
      view.openLayer = target;
      savePlan(steps);
    });
  });

  root.querySelectorAll<HTMLButtonElement>(".delete-layer").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.index);
      const step = state.allocation.steps[index];
      if (!step) return;
      if (!confirm(`Delete the ${step.name} layer? Money that reached it will flow to the layers below.`)) return;
      view.openLayer = null;
      savePlan(state.allocation.steps.filter((_, i) => i !== index));
    });
  });

  root.querySelectorAll<HTMLButtonElement>(".add-layer").forEach((button) => button.addEventListener("click", () => {
    // A new layer starts claiming nothing, so adding one cannot quietly change
    // where this month's money already went. It opens ready to be named.
    view.openLayer = state.allocation.steps.length;
    view.openBucket = null;
    view.overflowOpen = false;
    savePlan([...state.allocation.steps, {
      id: createId("layer"),
      name: "New layer",
      kind: "fill" as const,
      value: 0,
      note: "",
    }]);
  }));

  root.querySelectorAll<HTMLSelectElement>(".overflow-select").forEach((select) => select.addEventListener("change", () => {
    view.overflowOpen = false;
    savePlan([...state.allocation.steps], select.value);
  }));

  root.querySelector<HTMLElement>("#normalizeLayersBtn")?.addEventListener("click", () => {
    savePlan(normalizePercentSteps(state.allocation).steps);
  });

  // --- One-time buckets -----------------------------------------------------

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
      view.openBucket = null;
      repaint({ ...state, buckets });
    });
  });

  root.querySelectorAll<HTMLButtonElement>(".delete-bucket").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.index);
      const bucket = state.buckets[index];
      if (!bucket || !confirm(`Delete the ${bucket.label || bucket.name} bucket?`)) return;
      view.openBucket = null;
      repaint({ ...state, buckets: state.buckets.filter((_, i) => i !== index) });
    });
  });
}
