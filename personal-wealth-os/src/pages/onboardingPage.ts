/**
 * The new-user Q&A screen (PLAN.md O-2).
 *
 * Full screen, before the app shell exists — like the sign-in page. Six
 * optional questions, each answered with one line on what the number means
 * for the user, then "Your plan". Nothing is saved until "Start my plan":
 * main.ts then writes every answer in one save (one undo point) through
 * applyOnboardingAnswers.
 *
 * The draft lives in module state, not the DOM, so a re-render (a cloud
 * reconcile arriving mid-quiz) puts the user back on the same question with
 * what they already typed.
 *
 * Copy is English like the rest of the app. Amounts are rough by design and
 * the plan says so.
 */

import { escapeHtml } from "../html";
import {
  BUFFER_MONTHS,
  buildOnboardingPlan,
  type OnboardingAnswers,
  type OnboardingPlan,
  type PrimaryGoal,
} from "../onboardingQuiz";

export type QuizAnswers = Omit<OnboardingAnswers, "answeredAt">;

export interface OnboardingHandlers {
  /** Shown as "Welcome, <first name>". */
  userName: string;
  onFinish: (answers: QuizAnswers) => void;
  /** "I'll set up myself": leave the quiz without answering. */
  onSkipAll: () => void;
}

const QUESTION_COUNT = 6;
const PLAN_STEP = QUESTION_COUNT + 1;

const GOALS: Record<PrimaryGoal, [title: string, sub: string]> = {
  buffer: ["Build a safety buffer", "Money set aside for surprises"],
  invest: ["Start investing", "Grow money over the years"],
  save: ["Save for something", "A trip, a car, a wedding"],
  debt: ["Pay off debt", "A card, a loan, PTPTN"],
};

const GOAL_REPLY: Record<PrimaryGoal, string> = {
  buffer: "Good first move. We'll build your buffer first, and show you the month it's full.",
  invest: "We'll make sure your safety buffer is in place first, then show how much you can invest each month.",
  save: "We'll give your goal a date, and move it earlier or later as you save.",
  debt: "We'll put a monthly amount against it and show you the month it's cleared.",
};

let draft: { step: number; answers: QuizAnswers } = { step: 0, answers: {} };

/** Start over — used after the quiz is finished or left, so a later account starts clean. */
export function resetOnboardingDraft(): void {
  draft = { step: 0, answers: {} };
}

const rm = (value: number) => `RM ${Math.round(value).toLocaleString("en-MY")}`;
const num = (value: number) => `<span class="onb-num">${escapeHtml(rm(value))}</span>`;

function monthsFromNow(months: number): string {
  const date = new Date();
  date.setDate(1);
  date.setMonth(date.getMonth() + months);
  return date.toLocaleDateString("en-MY", { month: "long", year: "numeric" });
}

function reply(html: string, tone: "good" | "warn" = "good"): string {
  return `<div class="onb-reply onb-reply--${tone}" role="status"><span class="onb-reply__dot" aria-hidden="true"></span><div>${html}</div></div>`;
}

function moneyField(id: keyof QuizAnswers, label: string, chips: number[]): string {
  const value = draft.answers[id];
  return `
    <label class="onb-field" for="onb-${id}">
      <span class="onb-field__label">${label}</span>
      <span class="wu-affix onb-affix"><span>MYR</span><input class="wu-field onb-money" id="onb-${id}" data-answer="${id}"
        type="text" inputmode="decimal" autocomplete="off" placeholder="0" value="${typeof value === "number" ? value : ""}"></span>
    </label>
    ${chips.length ? `<div class="onb-chips">${chips.map((chip) =>
      `<button type="button" class="onb-chip" data-chip="${id}" data-value="${chip}">${Math.round(chip).toLocaleString("en-MY")}</button>`).join("")}</div>` : ""}`;
}

function actions(options: { next?: string; skip?: boolean; back?: boolean; nextDisabled?: boolean } = {}): string {
  const { next = "Continue", skip = true, back = true, nextDisabled = false } = options;
  return `<div class="onb-actions">
    ${back ? `<button type="button" class="wu-btn wu-btn--secondary" data-onb="back">Back</button>` : ""}
    <button type="button" class="wu-btn wu-btn--primary" data-onb="next"${nextDisabled ? " disabled" : ""}>${next}</button>
    ${skip ? `<button type="button" class="wu-btn wu-btn--ghost onb-skip" data-onb="skip">Skip for now</button>` : ""}
  </div>`;
}

function question(n: number, title: string, sub = ""): string {
  return `<p class="onb-eyebrow">Question ${n} of ${QUESTION_COUNT}</p>
    <h2 class="onb-q" tabindex="-1">${title}</h2>
    ${sub ? `<p class="onb-sub">${sub}</p>` : ""}`;
}

// --- live replies, recomputed as the user types -------------------------------

function spendingReply(plan: OnboardingPlan): string {
  const { monthlyIncome: income, monthlySpending: spending } = draft.answers;
  if (spending === undefined) return "";
  if (plan.leftover === null || income === undefined || income === 0) {
    return reply(`We'll keep an eye on this. When a month's spending passes ${num(spending)}, your Overview will say so.`);
  }
  if (plan.leftover <= 0) {
    return reply(`That's about ${num(-plan.leftover)} more than comes in. Common, and the first thing your plan will work on.`, "warn");
  }
  const share = Math.round((plan.leftover / income) * 100);
  return reply(`That leaves about ${num(plan.leftover)} a month, <span class="onb-num">${share}%</span> of what you earn. We'll help you decide where it goes.`);
}

function cashReply(plan: OnboardingPlan): string {
  if (draft.answers.cashInBank === undefined) return "";
  if (plan.monthsCovered === null || plan.bufferTarget === null) {
    return reply("We'll use this as the start of your safety buffer: money kept aside for surprises.");
  }
  const covered = `<span class="onb-num">${plan.monthsCovered.toFixed(1)}</span>`;
  const pct = Math.min(100, (plan.monthsCovered / BUFFER_MONTHS) * 100);
  const text = plan.bufferFull
    ? `That covers ${covered} months of spending. Your safety buffer is already full.`
    : `That covers ${covered} months of spending. A safety buffer is usually ${BUFFER_MONTHS} months: ${num(plan.bufferTarget)} for you.`;
  return reply(`${text}<span class="onb-meter" aria-hidden="true"><span style="width:${pct.toFixed(1)}%"></span></span>`, plan.monthsCovered < 1 ? "warn" : "good");
}

function goalReply(plan: OnboardingPlan): string {
  if (!draft.answers.goalAmount || !draft.answers.goalName) return "";
  if (plan.monthsToGoal === null) {
    return reply(plan.leftover === null
      ? "Add your income and spending later, and we'll put a date on this."
      : "Once there's money left over each month, we'll put a date on this.", "warn");
  }
  return reply(`At your pace that's about <span class="onb-num">${plan.monthsToGoal}</span> months: <span class="onb-num">${monthsFromNow(plan.monthsToGoal)}</span>.`);
}

function liveReply(step: number): string {
  const plan = buildOnboardingPlan({ ...draft.answers, answeredAt: "" });
  if (step === 3) return spendingReply(plan);
  if (step === 4) return cashReply(plan);
  if (step === 6) return goalReply(plan);
  return "";
}

// --- screens -------------------------------------------------------------------

function welcomeScreen(userName: string): string {
  const first = userName.trim().split(/\s+/)[0];
  return `
    <p class="onb-eyebrow">${first ? `Welcome, ${escapeHtml(first)}` : "Welcome"}</p>
    <h2 class="onb-q" tabindex="-1">Let's build your money plan.</h2>
    <p class="onb-sub">Six quick questions, about two minutes. Rough numbers are fine, and you can skip any of them.</p>
    <ul class="onb-preview">
      <li><span aria-hidden="true">1</span><div><strong>Where you are</strong>Income, spending, what you have.</div></li>
      <li><span aria-hidden="true">2</span><div><strong>Where you're going</strong>One goal is enough to start.</div></li>
      <li><span aria-hidden="true">3</span><div><strong>Your plan</strong>A safety buffer, a monthly split, a date for your goal.</div></li>
    </ul>
    <p class="onb-fine">Your answers stay private to you. For guidance only, not financial advice.</p>
    <div class="onb-actions">
      <button type="button" class="wu-btn wu-btn--primary" data-onb="next">Start</button>
      <button type="button" class="wu-btn wu-btn--ghost onb-skip" data-onb="skip-all">I'll set up myself</button>
    </div>`;
}

function goalScreen(): string {
  const chosen = draft.answers.primaryGoal;
  return `${question(1, "What matters most to you right now?")}
    <div class="onb-options" role="group" aria-label="Your main goal">
      ${(Object.keys(GOALS) as PrimaryGoal[]).map((goal) => `
        <button type="button" class="onb-option" data-goal="${goal}" aria-pressed="${chosen === goal}">
          <strong>${GOALS[goal][0]}</strong><small>${GOALS[goal][1]}</small>
        </button>`).join("")}
    </div>
    ${chosen ? reply(GOAL_REPLY[chosen]) : ""}
    ${actions({ nextDisabled: !chosen })}`;
}

function investScreen(): string {
  const invests = draft.answers.invests;
  const answer = invests === undefined ? "" : invests
    ? reply("We'll show your real return: after fees and currency, not just what the broker app says.")
    : reply("No problem. When your safety buffer is full, we'll show you it's time, and how much to put in each month.");
  return `${question(5, "Do you invest yet?")}
    <div class="onb-options" role="group" aria-label="Do you invest">
      <button type="button" class="onb-option" data-invests="yes" aria-pressed="${invests === true}"><strong>Yes</strong><small>Stocks, ETFs, unit trusts</small></button>
      <button type="button" class="onb-option" data-invests="no" aria-pressed="${invests === false}"><strong>Not yet</strong><small>Planning to, or not sure</small></button>
    </div>
    ${answer}
    ${actions({ nextDisabled: invests === undefined })}`;
}

function goalAmountScreen(): string {
  const debt = draft.answers.primaryGoal === "debt";
  return `${question(6, debt ? "How much debt do you want to clear?" : "What are you saving for?", "One is enough. You can add more later.")}
    <div class="onb-row">
      <label class="onb-field" for="onb-goalName">
        <span class="onb-field__label">Name it</span>
        <input class="wu-field" id="onb-goalName" data-answer-text="goalName" maxlength="60" autocomplete="off"
          placeholder="${debt ? "Credit card" : "Japan trip"}" value="${escapeHtml(draft.answers.goalName ?? "")}">
      </label>
      ${moneyField("goalAmount", "Amount", [])}
    </div>
    <div class="onb-live">${liveReply(6)}</div>
    ${actions({ next: "See my plan" })}`;
}

function planScreen(): string {
  const answers = draft.answers;
  const plan = buildOnboardingPlan({ ...answers, answeredAt: "" });
  const goalName = answers.goalName && answers.goalAmount ? escapeHtml(answers.goalName) : "";
  const cards: string[] = [];

  if (plan.bufferTarget !== null && plan.bufferTarget > 0) {
    const have = Math.min(answers.cashInBank ?? 0, plan.bufferTarget);
    const when = plan.bufferFull ? "Already full. Keep it there."
      : plan.monthsToBufferFull !== null ? `Full in about ${plan.monthsToBufferFull} months if you add ${rm(plan.split.buffer)} a month.`
        : "We'll set a pace once there's money left over each month.";
    cards.push(`<div class="onb-card"><span class="onb-card__k">Safety buffer</span>
      <span class="onb-card__v">${num(have)} <small>/ ${escapeHtml(rm(plan.bufferTarget))}</small></span>
      <p>${when}</p></div>`);
  }

  if (plan.leftover !== null && plan.leftover > 0) {
    const parts: Array<[string, number, string]> = [
      ["Buffer", plan.split.buffer, "var(--warning)"],
      [goalName || "Goal", plan.split.goal, "var(--accent)"],
      ["Invest", plan.split.invest, "var(--text-muted)"],
    ].filter(([, amount]) => (amount as number) > 0) as Array<[string, number, string]>;
    cards.push(`<div class="onb-card"><span class="onb-card__k">Each month · ${escapeHtml(rm(plan.leftover))} left over</span>
      <span class="onb-split" aria-hidden="true">${parts.map(([, amount, color]) => `<span style="flex:${amount};background:${color}"></span>`).join("")}</span>
      <span class="onb-legend">${parts.map(([label, amount, color]) =>
        `<span><i style="background:${color}"></i>${label}<b>${escapeHtml(rm(amount))}</b></span>`).join("")}</span></div>`);
  } else if (plan.leftover !== null) {
    cards.push(`<div class="onb-card"><span class="onb-card__k">Each month</span>
      <p>${plan.leftover < 0
        ? `Spending is ${escapeHtml(rm(-plan.leftover))} above income right now. Your plan starts by closing that gap.`
        : "Spending matches income right now. Your plan starts by making some room each month."}</p></div>`);
  }

  if (goalName) {
    cards.push(`<div class="onb-card"><span class="onb-card__k">${goalName}</span>
      <span class="onb-card__v">${num(answers.goalAmount ?? 0)}</span>
      <p>${plan.monthsToGoal !== null ? `Reached around <strong>${monthsFromNow(plan.monthsToGoal)}</strong>.` : "We'll date this once there's money left over each month."}</p></div>`);
  }

  const services: string[] = [];
  if (answers.monthlySpending) services.push(`Flag it on your Overview when a month's spending passes ${rm(answers.monthlySpending)}`);
  if (plan.bufferTarget) services.push(`Track your safety buffer toward ${rm(plan.bufferTarget)}`);
  if (answers.invests) services.push("Track your real investment return, after fees and currency");
  else if (plan.bufferTarget) services.push("Show you when your buffer is full, so you know when to start investing");
  if (goalName) {
    services.push(answers.primaryGoal === "debt"
      ? `Show the month ${goalName} is cleared, as you pay it down`
      : `Keep ${goalName}'s date up to date as you save`);
  }
  const headline = !cards.length ? "You're ready to start."
    : plan.leftover !== null && plan.leftover > 0 ? "Here's where your money goes from here." : "Here's your starting point.";

  return `
    <p class="onb-eyebrow">Your plan</p>
    <h2 class="onb-q" tabindex="-1">${headline}</h2>
    ${cards.length ? `<div class="onb-plan">${cards.join("")}</div>` : `<p class="onb-sub">You skipped the numbers, which is fine. Your Overview will walk you through them one at a time.</p>`}
    ${services.length ? `<p class="onb-eyebrow">WealthUp will</p>
    <ul class="onb-services">${services.map((service) => `<li>${escapeHtml(service)}</li>`).join("")}</ul>` : ""}
    <p class="onb-fine">${cards.length ? "Estimates from the numbers you entered. " : ""}For guidance only, not financial advice.</p>
    ${actions({ next: "Start my plan", skip: false })}`;
}

function screenFor(step: number, userName: string): string {
  switch (step) {
    case 0: return welcomeScreen(userName);
    case 1: return goalScreen();
    case 2: return `${question(2, "Roughly how much comes in each month?", "After tax and EPF. A round number is fine.")}
      ${moneyField("monthlyIncome", "Monthly take-home", [2500, 4000, 6000, 9000])}
      ${reply("We'll route every ringgit of this through your plan, so you can see where it should go before it's spent.")}
      ${actions()}`;
    case 3: return `${question(3, "And roughly how much goes out?", "Rent, food, transport, bills, fun. Your best guess.")}
      ${moneyField("monthlySpending", "Monthly spending", [1500, 2500, 3500, 5000])}
      <div class="onb-live">${liveReply(3)}</div>
      ${actions()}`;
    case 4: return `${question(4, "How much do you have in the bank today?", "Savings and current accounts together. Not investments.")}
      ${moneyField("cashInBank", "Cash in the bank", [1000, 5000, 10000, 20000])}
      <div class="onb-live">${liveReply(4)}</div>
      ${actions()}`;
    case 5: return investScreen();
    case 6: return goalAmountScreen();
    default: return planScreen();
  }
}

function parseAmount(raw: string): number | undefined {
  const cleaned = raw.replace(/[^\d.]/g, "");
  if (!cleaned) return undefined;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : undefined;
}

export function renderOnboarding(root: HTMLElement, handlers: OnboardingHandlers): void {
  root.className = "onboarding-shell";
  const step = Math.min(draft.step, PLAN_STEP);
  const progress = step === 0 ? 0 : Math.min(100, (step / PLAN_STEP) * 100);
  root.innerHTML = `
    <main class="onb" aria-label="Set up your plan">
      <div class="onb-bar">
        <span class="onb-brand"><img src="/brand/wealth-mark.png" alt="">WealthUp</span>
        <span class="onb-progress" aria-hidden="true"><span style="width:${progress}%"></span></span>
        <span class="onb-count">${step >= 1 && step <= QUESTION_COUNT ? `${step}/${QUESTION_COUNT}` : ""}</span>
      </div>
      <section class="onb-screen">${screenFor(step, handlers.userName)}</section>
    </main>`;

  const rerender = () => renderOnboarding(root, handlers);
  const go = (next: number) => { draft.step = Math.max(0, Math.min(PLAN_STEP, next)); rerender(); };
  const liveBox = () => root.querySelector<HTMLElement>(".onb-live");

  root.querySelector<HTMLElement>(".onb-q")?.focus({ preventScroll: true });

  root.querySelectorAll<HTMLInputElement>("[data-answer]").forEach((input) => {
    input.addEventListener("input", () => {
      const key = input.dataset.answer as "monthlyIncome" | "monthlySpending" | "cashInBank" | "goalAmount";
      draft.answers[key] = parseAmount(input.value);
      const box = liveBox();
      if (box) box.innerHTML = liveReply(draft.step);
    });
  });
  root.querySelectorAll<HTMLInputElement>("[data-answer-text]").forEach((input) => {
    input.addEventListener("input", () => {
      draft.answers.goalName = input.value.trim() || undefined;
      const box = liveBox();
      if (box) box.innerHTML = liveReply(draft.step);
    });
  });
  // Enter in a field means Continue.
  root.querySelectorAll<HTMLInputElement>("input").forEach((input) => input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") root.querySelector<HTMLButtonElement>('[data-onb="next"]')?.click();
  }));

  root.querySelector(".onb-screen")?.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button");
    if (!button || button.disabled) return;
    if (button.dataset.goal) {
      draft.answers.primaryGoal = button.dataset.goal as PrimaryGoal;
      rerender();
      return;
    }
    if (button.dataset.invests) {
      draft.answers.invests = button.dataset.invests === "yes";
      rerender();
      return;
    }
    if (button.dataset.chip) {
      const input = root.querySelector<HTMLInputElement>(`#onb-${button.dataset.chip}`);
      if (input) {
        input.value = button.dataset.value ?? "";
        input.dispatchEvent(new Event("input"));
        input.focus();
      }
      return;
    }
    switch (button.dataset.onb) {
      case "back": go(draft.step - 1); break;
      case "next":
        if (draft.step === PLAN_STEP) {
          const answers = { ...draft.answers };
          resetOnboardingDraft();
          handlers.onFinish(answers);
        } else go(draft.step + 1);
        break;
      case "skip": {
        // Skipping a question clears whatever was half-entered for it.
        const cleared: Array<keyof QuizAnswers> = ({
          1: ["primaryGoal"], 2: ["monthlyIncome"], 3: ["monthlySpending"], 4: ["cashInBank"], 5: ["invests"], 6: ["goalName", "goalAmount"],
        } as Record<number, Array<keyof QuizAnswers>>)[draft.step] ?? [];
        for (const key of cleared) delete draft.answers[key];
        go(draft.step + 1);
        break;
      }
      case "skip-all":
        resetOnboardingDraft();
        handlers.onSkipAll();
        break;
    }
  });
}
