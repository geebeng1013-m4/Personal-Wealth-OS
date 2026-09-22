/**
 * The new-user Q&A screen (PLAN.md O-2, rewritten as sentences in Q-4).
 *
 * Full screen, before the app shell exists — like the sign-in page. The
 * questions are sentences to finish ("I'm [a student ▾]"), one page that grows
 * as each one is answered, with a short reply under every answer on what the
 * number means for the user. Then "Your plan", with the stage it puts them in.
 * Nothing is saved until "Start my plan": main.ts then writes every answer in
 * one save (one undo point) through applyOnboardingAnswers.
 *
 * Every sentence can be skipped ("Rather not say"). The draft lives in module
 * state, not the DOM, so a re-render (a cloud reconcile arriving mid-quiz)
 * puts the user back where they were with what they already picked.
 *
 * Copy is English like the rest of the app. Amounts are rough by design and
 * the plan says so.
 */

import { escapeHtml } from "../html";
import { emptyState } from "../state";
import { classifyStage, STAGE_COUNT, type MoneyStageId } from "../moneyStage";
import {
  answeredCash,
  applyOnboardingAnswers,
  BUFFER_BANDS,
  bufferMonthsFor,
  buildOnboardingPlan,
  CASH_KEPT_IN,
  incomeRangesFor,
  LIFE_STAGES,
  LONG_TERM_GOALS,
  PRIMARY_GOALS,
  type BufferBand,
  type CashKeptIn,
  type LifeStage,
  type LongTermGoal,
  type OnboardingAnswers,
  type OnboardingPlan,
  type PrimaryGoal,
} from "../onboardingQuiz";

export type QuizAnswers = Omit<OnboardingAnswers, "answeredAt">;

export interface OnboardingHandlers {
  /** Shown as "Hi, <first name>". */
  userName: string;
  onFinish: (answers: QuizAnswers) => void;
  /** "I'll set up myself": leave the quiz without answering. */
  onSkipAll: () => void;
}

// --- the words ------------------------------------------------------------------

const LIFE_LABEL: Record<LifeStage, string> = {
  student: "a student",
  working: "working full-time",
  "self-employed": "self-employed",
  "between-jobs": "between jobs",
  retired: "retired",
};
const LIFE_REPLY: Record<LifeStage, string> = {
  student: "Nice. Starting this early is the biggest head start there is.",
  working: "Got it. Let's see what comes in each month.",
  "self-employed": "Income that changes month to month? We'll plan with a bigger safety buffer.",
  "between-jobs": "We'll keep the plan light until pay is steady again.",
  retired: "Then the focus is making your savings last.",
};
const KEPT_LABEL: Record<CashKeptIn, string> = {
  savings: "a savings account",
  "fixed-deposit": "fixed deposits",
  "money-market": "a money market fund",
  asb: "ASB / ASNB",
  "e-wallet": "an e-wallet",
  cash: "cash at home",
};
const KEPT_REPLY: Record<CashKeptIn, [text: string, warn: boolean]> = {
  savings: ["", false],
  "fixed-deposit": ["Good for money you won't touch. Keep a slice somewhere you can reach in a day.", false],
  "money-market": ["Sensible: it usually earns more than a savings account and you can still reach it quickly.", false],
  asb: ["Steady and easy to withdraw. We'll count it as part of your buffer.", false],
  "e-wallet": ["Easy to reach, and also easy to spend. A separate savings account keeps it out of sight.", true],
  cash: ["It works, but it earns nothing and is easy to dip into. A savings account is safer.", true],
};
const GOAL_LABEL: Record<PrimaryGoal, string> = {
  buffer: "build a safety buffer",
  invest: "start investing",
  save: "save for something",
  debt: "pay off debt",
};
const GOAL_REPLY: Record<PrimaryGoal, string> = {
  buffer: "Good first move. We'll build your buffer first, and show you the month it's full.",
  invest: "We'll make sure your safety buffer is in place first, then show how much you can invest each month.",
  save: "Let's give it a date.",
  debt: "We'll put a monthly amount against it and show you the month it's cleared.",
};
const LONG_LABEL: Record<LongTermGoal, string> = {
  retirement: "Retirement",
  home: "A home",
  "kids-education": "Kids' education",
  "self-education": "Self-education",
  travel: "Travel",
  "not-sure": "Not sure yet",
};
const STAGE_SHORT: Record<MoneyStageId, string> = {
  debt: "Paying down debt",
  base: "Getting a base",
  buffer: "Building your buffer",
  ready: "Ready to invest",
  growing: "Growing",
};
const SPEND_CHIPS = { student: [300, 600, 1000, 1500], other: [1500, 2500, 3500, 5000] };
const GOAL_AMOUNTS = [500, 1000, 3000, 5000, 10000, 30000];
const CUSTOM = "custom";

// --- the draft ------------------------------------------------------------------

/** The sentences in order. Each is answered or skipped before the next shows. */
type SentenceId = "life" | "income" | "spending" | "savings" | "want" | "goal" | "longTerm" | "invests";
const SENTENCES: readonly SentenceId[] = ["life", "income", "spending", "savings", "want", "goal", "longTerm", "invests"];

interface Draft {
  screen: "welcome" | "sentences" | "plan";
  answers: QuizAnswers;
  skipped: Set<SentenceId>;
  /** The amount pickers set to "Type an amount…", so their field stays open while empty. */
  typing: Set<"income" | "spending" | "goal">;
  /** The sentence to scroll into view after the next render. */
  reveal: SentenceId | null;
}

const freshDraft = (): Draft => ({ screen: "welcome", answers: {}, skipped: new Set(), typing: new Set(), reveal: null });
let draft: Draft = freshDraft();
/** Typed text applies after this pause (or on Enter). */
const TYPING_PAUSE_MS = 700;
let typingTimer = 0;

/** Start over — used after the quiz is finished or left, so a later account starts clean. */
export function resetOnboardingDraft(): void {
  draft = freshDraft();
}

const needsGoal = (): boolean => draft.answers.primaryGoal === "save" || draft.answers.primaryGoal === "debt";

function answered(id: SentenceId): boolean {
  const a = draft.answers;
  switch (id) {
    case "life": return a.lifeStage !== undefined;
    case "income": return a.monthlyIncome !== undefined;
    case "spending": return a.monthlySpending !== undefined;
    case "savings": return a.bufferMonthsHave !== undefined && a.cashKeptIn !== undefined;
    case "want": return a.primaryGoal !== undefined;
    case "goal": return Boolean(a.goalName) && (a.goalAmount ?? 0) > 0;
    case "longTerm": return (a.longTermGoals?.length ?? 0) > 0;
    case "invests": return a.invests !== undefined;
  }
}
const settled = (id: SentenceId): boolean => answered(id) || draft.skipped.has(id);
/** How many sentences are on screen: every settled one, plus the first open one. */
function shownCount(): number {
  const open = SENTENCES.findIndex((id) => !settled(id));
  return open === -1 ? SENTENCES.length : open + 1;
}

/** What a skipped sentence clears, so a half-picked answer is not saved. */
const CLEARS: Record<SentenceId, Array<keyof QuizAnswers>> = {
  life: ["lifeStage"],
  income: ["monthlyIncome", "incomeRange"],
  spending: ["monthlySpending"],
  savings: ["bufferMonthsHave", "cashKeptIn"],
  want: ["primaryGoal"],
  goal: ["goalName", "goalAmount"],
  longTerm: ["longTermGoals"],
  invests: ["invests"],
};

// --- small parts ----------------------------------------------------------------

const rm = (value: number) => `RM${Math.round(value).toLocaleString("en-MY")}`;
const num = (text: string) => `<span class="onb-num">${escapeHtml(text)}</span>`;

function monthsFromNow(months: number): string {
  const date = new Date();
  date.setDate(1);
  date.setMonth(date.getMonth() + months);
  return date.toLocaleDateString("en-MY", { month: "long", year: "numeric" });
}

/** A reply from WealthUp under an answer. `html` is trusted: callers escape what they interpolate. */
function bubble(html: string, tone: "good" | "warn" = "good"): string {
  return `<div class="onb-bubble onb-bubble--${tone}" role="status"><img class="onb-bubble__mark" src="/brand/wealth-mark.png" alt=""><div>${html}</div></div>`;
}

/** A picker inside the sentence. An unanswered one reads "choose". */
function pick(id: string, label: string, value: string, options: Array<[value: string, label: string]>): string {
  return `<select class="onb-pill${value ? " is-set" : ""}" id="onb-${id}" data-pick="${id}" aria-label="${escapeHtml(label)}">
      <option value=""${value ? "" : " selected"} disabled hidden>choose</option>
      ${options.map(([optionValue, optionLabel]) => `<option value="${escapeHtml(optionValue)}"${optionValue === value ? " selected" : ""}>${escapeHtml(optionLabel)}</option>`).join("")}
    </select>`;
}

/** A typed amount inside the sentence, for "Type an amount…". */
function typedAmount(id: "income" | "spending" | "goal", label: string, value: number | undefined): string {
  return `<input class="onb-pill onb-pill--text onb-pill--money${value ? " is-set" : ""}" id="onb-${id}-amount" data-amount="${id}"
      type="text" inputmode="decimal" autocomplete="off" placeholder="RM" aria-label="${escapeHtml(label)}" value="${value ?? ""}">`;
}

function skipLink(id: SentenceId): string {
  return settled(id) ? "" : `<button type="button" class="onb-skipline" data-skip="${id}">Rather not say</button>`;
}

function sentence(id: SentenceId, line: string, reply = ""): string {
  return `<div class="onb-sentence" data-sentence="${id}">
      <p class="onb-line">${line}</p>
      ${reply}
      ${skipLink(id)}
    </div>`;
}

function parseAmount(raw: string): number | undefined {
  const cleaned = raw.replace(/[^\d.]/g, "");
  if (!cleaned) return undefined;
  const value = Number(cleaned);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

// --- the sentences --------------------------------------------------------------

function draftPlan(): OnboardingPlan {
  return buildOnboardingPlan({ ...draft.answers, answeredAt: "" });
}

function lifeSentence(): string {
  const life = draft.answers.lifeStage;
  return sentence("life", `I'm ${pick("life", "What you do", life ?? "", LIFE_STAGES.map((stage) => [stage, LIFE_LABEL[stage]]))}.`,
    life ? bubble(escapeHtml(LIFE_REPLY[life])) : "");
}

function incomeSentence(): string {
  const a = draft.answers;
  const ranges = incomeRangesFor(a.lifeStage);
  const typing = draft.typing.has("income");
  const value = typing ? CUSTOM : a.incomeRange ?? "";
  const tail = a.lifeStage === "student" ? "comes in each month (allowance, part-time)." : "comes in each month, after tax and EPF.";
  const range = ranges.find((item) => item.id === a.incomeRange);
  const reply = a.monthlyIncome === undefined ? "" : bubble(`We'll route every ringgit of this through your plan.${range
    ? `<small class="onb-bubble__est">We'll use about ${escapeHtml(rm(range.estimate))} as the estimate. You can change it any time.</small>` : ""}`);
  return sentence("income", `About ${pick("income", "Monthly income", value, [...ranges.map((item): [string, string] => [item.id, item.label]), [CUSTOM, "Type an amount…"]])}
      ${typing ? typedAmount("income", "Monthly income in RM", a.monthlyIncome) : ""} ${tail}`, reply);
}

function spendingSentence(): string {
  const a = draft.answers;
  const chips = SPEND_CHIPS[a.lifeStage === "student" ? "student" : "other"];
  const typing = draft.typing.has("spending") || (a.monthlySpending !== undefined && !chips.includes(a.monthlySpending));
  const value = typing ? CUSTOM : a.monthlySpending !== undefined ? String(a.monthlySpending) : "";
  let reply = "";
  if (a.monthlySpending !== undefined) {
    const plan = draftPlan();
    const months = bufferMonthsFor(a);
    if (plan.leftover !== null && a.monthlyIncome) {
      reply += plan.leftover > 0
        ? bubble(`That leaves about ${num(rm(plan.leftover))} a month, ${num(`${Math.round((plan.leftover / a.monthlyIncome) * 100)}%`)} of what comes in.`)
        : bubble(`That's about ${num(rm(-plan.leftover))} more than comes in. Common, and the first thing your plan works on.`, "warn");
    }
    reply += bubble(`${a.lifeStage === "self-employed"
      ? `With income that moves around, keep ${num(`${months} months`)} of spending aside for surprises`
      : `A common rule of thumb: keep ${num(`${months} months`)} of spending aside for surprises`}. For you that's about ${num(rm(a.monthlySpending * months))}.<br>How about you?`);
  }
  return sentence("spending", `I spend about ${pick("spending", "Monthly spending", value, [...chips.map((chip): [string, string] => [String(chip), rm(chip)]), [CUSTOM, "Type an amount…"]])}
      ${typing ? typedAmount("spending", "Monthly spending in RM", a.monthlySpending) : ""} a month.`, reply);
}

function savingsSentence(): string {
  const a = draft.answers;
  const band = a.bufferMonthsHave;
  let reply = "";
  if (band && a.cashKeptIn) {
    const target = bufferMonthsFor(a);
    const have = BUFFER_BANDS[band].months;
    const text = have >= target ? "Your buffer is already full. That puts you ahead of most people."
      : have === 0 ? "Then that's where we start: a little each month, and we'll show you the month it's full."
        : `You're about ${num(`${Math.min(99, Math.round((have / target) * 100))}%`)} of the way there.`;
    const [kept, keptWarn] = KEPT_REPLY[a.cashKeptIn];
    reply = bubble(`${text}${kept ? `<br>${escapeHtml(kept)}` : ""}`, have < 1 || keptWarn ? "warn" : "good")
      + bubble("Now, what would you like your money to do?");
  }
  const bands = Object.entries(BUFFER_BANDS) as Array<[BufferBand, { label: string }]>;
  return sentence("savings", `I have ${pick("savings", "Months of spending saved", band ?? "", bands.map(([id, item]) => [id, item.label]))} saved${band
    ? `, mostly in ${pick("kept", "Where your savings are", a.cashKeptIn ?? "", CASH_KEPT_IN.map((kept) => [kept, KEPT_LABEL[kept]]))}` : ""}.`, reply);
}

function wantSentence(): string {
  const want = draft.answers.primaryGoal;
  return sentence("want", `Right now I most want to ${pick("want", "What matters most", want ?? "", PRIMARY_GOALS.map((goal) => [goal, GOAL_LABEL[goal]]))}.`,
    want ? bubble(escapeHtml(GOAL_REPLY[want])) : "");
}

function goalSentence(): string {
  const a = draft.answers;
  const debt = a.primaryGoal === "debt";
  const typing = draft.typing.has("goal") || (a.goalAmount !== undefined && !GOAL_AMOUNTS.includes(a.goalAmount));
  const value = typing ? CUSTOM : a.goalAmount !== undefined ? String(a.goalAmount) : "";
  let reply = "";
  if (answered("goal")) {
    const plan = draftPlan();
    reply = plan.monthsToGoal !== null
      ? bubble(`At your pace, about ${num(`${plan.monthsToGoal} months`)}: ${num(monthsFromNow(plan.monthsToGoal))}.<small class="onb-bubble__est">An estimate, from ${escapeHtml(rm(plan.split.goal))} a month.</small>`)
      : bubble(plan.leftover === null ? "Add your income and spending later, and we'll put a date on this." : "Once there's money left over each month, we'll put a date on this.", "warn");
  }
  const name = `<input class="onb-pill onb-pill--text${a.goalName ? " is-set" : ""}" id="onb-goal-name" data-goal-name maxlength="60" autocomplete="off"
      placeholder="${debt ? "a credit card" : "a Japan trip"}" aria-label="${debt ? "What the debt is" : "What you're saving for"}" value="${escapeHtml(a.goalName ?? "")}">`;
  const amount = pick("goal", debt ? "How much is owed" : "How much it costs", value, [...GOAL_AMOUNTS.map((item): [string, string] => [String(item), rm(item)]), [CUSTOM, "Type an amount…"]]);
  const line = debt
    ? `The debt is ${name} of ${amount}${typing ? ` ${typedAmount("goal", "Debt amount in RM", a.goalAmount)}` : ""}.`
    : `In the short term, I'm saving for ${name} costing ${amount}${typing ? ` ${typedAmount("goal", "Goal amount in RM", a.goalAmount)}` : ""}.`;
  // For a buffer or investing, a named goal is a bonus: "Nothing yet" moves on.
  return sentence("goal", line, reply).replace("Rather not say", needsGoal() ? "Rather not say" : "Nothing yet");
}

function longTermSentence(): string {
  const chosen = new Set(draft.answers.longTermGoals ?? []);
  const reply = chosen.size === 0 ? "" : chosen.has("not-sure")
    ? bubble("That's fine. Most people work it out once the first goal is done.")
    : bubble("Noted. One goal at a time is enough to start; these are for later.");
  return sentence("longTerm", `Long term, I care about
      <span class="onb-chips onb-chips--pick" role="group" aria-label="Long-term goals">${LONG_TERM_GOALS.map((goal) =>
    `<button type="button" class="onb-chip" data-long="${goal}" aria-pressed="${chosen.has(goal)}">${escapeHtml(LONG_LABEL[goal])}</button>`).join("")}</span>`, reply);
}

function investSentence(): string {
  const invests = draft.answers.invests;
  const value = invests === undefined ? "" : invests ? "yes" : "no";
  return sentence("invests", `And I ${pick("invests", "Do you invest", value, [["yes", "already"], ["no", "don't yet"]])} invest.`,
    invests === undefined ? "" : bubble(invests
      ? "We'll show your real return: after fees and currency, not just what the broker app says."
      : "No problem. When your buffer is full, we'll tell you it's time, and how much to put in."));
}

const RENDER: Record<SentenceId, () => string> = {
  life: lifeSentence,
  income: incomeSentence,
  spending: spendingSentence,
  savings: savingsSentence,
  want: wantSentence,
  goal: goalSentence,
  longTerm: longTermSentence,
  invests: investSentence,
};

// --- screens --------------------------------------------------------------------

function welcomeScreen(userName: string): string {
  const first = userName.trim().split(/\s+/)[0];
  return `
    <p class="onb-eyebrow">${first ? `Hi, ${escapeHtml(first)}` : "Welcome"}</p>
    <h2 class="onb-q" tabindex="-1">Let's build your money plan.</h2>
    <p class="onb-sub">Finish a few sentences about your money: about a minute. Rough answers are fine, and you can skip any of them.</p>
    <ul class="onb-preview">
      <li><span aria-hidden="true">1</span><div><strong>Where you are</strong>What comes in, what goes out, what you've saved.</div></li>
      <li><span aria-hidden="true">2</span><div><strong>Where you're going</strong>One goal is enough to start.</div></li>
      <li><span aria-hidden="true">3</span><div><strong>Your plan</strong>Your stage, a monthly split, a date for your goal.</div></li>
    </ul>
    <p class="onb-fine">Your answers stay private to you. For guidance only, not financial advice.</p>
    <div class="onb-actions">
      <button type="button" class="wu-btn wu-btn--primary" data-onb="start">Start</button>
      <button type="button" class="wu-btn wu-btn--ghost onb-skip" data-onb="skip-all">I'll set up myself</button>
    </div>`;
}

function sentencesScreen(): string {
  const shown = shownCount();
  const done = SENTENCES.every(settled);
  return `
    <h2 class="onb-q" tabindex="-1">Tell us about your money.</h2>
    <div class="onb-flow">${SENTENCES.slice(0, shown).map((id) => RENDER[id]()).join("")}</div>
    <div class="onb-foot">
      <button type="button" class="wu-btn wu-btn--primary onb-foot__next" data-onb="plan"${done ? "" : " disabled"}>${done ? "See my plan" : `${SENTENCES.filter(settled).length} of ${SENTENCES.length} answered`}</button>
      <p class="onb-fine">Private to you. For guidance only, not financial advice.</p>
    </div>`;
}

function stageCard(answers: QuizAnswers): string {
  // The same classification the Overview will show, run on the state these
  // answers would create — so the plan screen and the Overview agree.
  const preview = applyOnboardingAnswers(emptyState(), answers, { goalId: "preview", today: new Date().toLocaleDateString("en-CA") });
  const stage = classifyStage(preview);
  const onTrack = stage.step !== null;
  const path = onTrack
    ? `<div class="onb-path" aria-hidden="true">${(["base", "buffer", "ready", "growing"] as const).map((id, index) =>
      `<div class="${index + 1 === stage.step ? "is-now" : index + 1 < (stage.step ?? 0) ? "is-past" : ""}"><i></i>${STAGE_SHORT[id]}</div>`).join("")}</div>`
    : "";
  return `<div class="onb-card onb-card--stage">
      <span class="onb-card__k">${onTrack ? `You're at · Stage ${stage.step} of ${STAGE_COUNT}` : "Your track · Debt first"}</span>
      <span class="onb-card__title">${escapeHtml(stage.title)}</span>
      ${path}
      <p>Because: ${escapeHtml(stage.reason)}</p>
    </div>`;
}

function planScreen(): string {
  const answers = draft.answers;
  const plan = draftPlan();
  const goalName = answers.goalName && answers.goalAmount ? escapeHtml(answers.goalName) : "";
  const cash = answeredCash(answers) ?? 0;
  const months = bufferMonthsFor(answers);
  const cards: string[] = [stageCard(answers)];

  if (plan.leftover !== null && plan.leftover > 0) {
    const parts: Array<[string, number, string]> = ([
      ["Buffer", plan.split.buffer, "var(--warning)"],
      [goalName || "Goal", plan.split.goal, "var(--accent)"],
      ["Invest", plan.split.invest, "var(--text-muted)"],
    ] as Array<[string, number, string]>).filter(([, amount]) => amount > 0);
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

  if (plan.bufferTarget !== null && plan.bufferTarget > 0) {
    const when = plan.bufferFull ? "Already full. Keep it there."
      : plan.debtFirst ? `On hold at ${rm(plan.starterTarget)} (a month of spending) while the debt is paid off.`
      : plan.monthsToBufferFull !== null ? `Full around ${monthsFromNow(plan.monthsToBufferFull)} if you add ${rm(plan.split.buffer)} a month.`
        : "We'll set a pace once there's money left over each month.";
    cards.push(`<div class="onb-card"><span class="onb-card__k">Safety buffer · ${months} months</span>
      <span class="onb-card__v">${num(rm(Math.min(cash, plan.bufferTarget)))} <small>/ ${escapeHtml(rm(plan.bufferTarget))}</small></span>
      <p>${when}</p></div>`);
  }

  if (goalName) {
    cards.push(`<div class="onb-card"><span class="onb-card__k">${goalName}</span>
      <span class="onb-card__v">${num(rm(answers.goalAmount ?? 0))}</span>
      <p>${plan.monthsToGoal !== null ? `Reached around <strong>${monthsFromNow(plan.monthsToGoal)}</strong>.` : "We'll date this once there's money left over each month."}</p></div>`);
  }

  const services: string[] = [];
  if (answers.monthlySpending) services.push(`Flag it on your Overview when a month's spending passes ${rm(answers.monthlySpending)}`);
  if (plan.bufferTarget) services.push(`Track your safety buffer toward ${rm(plan.bufferTarget)}`);
  if (answers.invests) services.push("Track your real investment return, after fees and currency");
  else if (plan.bufferTarget) services.push("Tell you when your buffer is full, so you know it's time to invest");
  if (goalName) {
    services.push(answers.primaryGoal === "debt"
      ? `Show the month ${answers.goalName} is cleared, as you pay it down`
      : `Keep ${answers.goalName}'s date up to date as you save`);
  }
  const headline = plan.leftover !== null && plan.leftover > 0 ? "Here's where your money goes from here." : "Here's your starting point.";

  return `
    <p class="onb-eyebrow">Your plan</p>
    <h2 class="onb-q" tabindex="-1">${headline}</h2>
    <div class="onb-plan">${cards.join("")}</div>
    ${services.length ? `<p class="onb-eyebrow">WealthUp will</p>
    <ul class="onb-services">${services.map((service) => `<li>${escapeHtml(service)}</li>`).join("")}</ul>` : ""}
    <p class="onb-fine">Estimates from your answers. For guidance only, not financial advice.</p>
    <div class="onb-actions">
      <button type="button" class="wu-btn wu-btn--secondary" data-onb="back">Change an answer</button>
      <button type="button" class="wu-btn wu-btn--primary" data-onb="finish">Start my plan</button>
    </div>`;
}

// --- render and bind ------------------------------------------------------------

export function renderOnboarding(root: HTMLElement, handlers: OnboardingHandlers): void {
  root.className = "onboarding-shell";
  const settledCount = SENTENCES.filter(settled).length;
  const progress = draft.screen === "welcome" ? 0 : draft.screen === "plan" ? 100 : Math.round((settledCount / (SENTENCES.length + 1)) * 100);
  const active = document.activeElement;
  const focusedId = active instanceof HTMLElement && root.contains(active) ? active.id : "";
  const caret = active instanceof HTMLInputElement && root.contains(active) ? active.selectionStart : null;
  clearTimeout(typingTimer);
  root.innerHTML = `
    <main class="onb" aria-label="Set up your plan">
      <div class="onb-bar">
        <span class="onb-brand"><img src="/brand/wealth-mark.png" alt="">WealthUp</span>
        <span class="onb-progress" aria-hidden="true"><span style="width:${progress}%"></span></span>
      </div>
      <section class="onb-screen onb-screen--${draft.screen}">${draft.screen === "welcome" ? welcomeScreen(handlers.userName)
        : draft.screen === "plan" ? planScreen() : sentencesScreen()}</section>
    </main>`;

  const rerender = () => renderOnboarding(root, handlers);
  const shownAtRender = shownCount();
  const settle = () => {
    for (const id of SENTENCES) if (answered(id)) draft.skipped.delete(id);
    // A newly shown sentence is brought into view and its first picker focused.
    const now = shownCount();
    if (now > shownAtRender && draft.screen === "sentences") draft.reveal = SENTENCES[now - 1] ?? null;
    rerender();
  };

  // Focus: the revealed sentence's first control, else whatever had focus, else the heading.
  const revealed = draft.reveal ? root.querySelector<HTMLElement>(`[data-sentence="${draft.reveal}"]`) : null;
  if (revealed && SENTENCES.every(settled) === false) {
    revealed.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    revealed.querySelector<HTMLElement>("select, input, button")?.focus({ preventScroll: true });
  } else if (focusedId && root.querySelector(`#${CSS.escape(focusedId)}`)) {
    const again = root.querySelector<HTMLElement>(`#${CSS.escape(focusedId)}`);
    again?.focus({ preventScroll: true });
    if (again instanceof HTMLInputElement && caret !== null) again.setSelectionRange(caret, caret);
  } else if (!draft.reveal) {
    root.querySelector<HTMLElement>(".onb-q")?.focus({ preventScroll: true });
  }
  draft.reveal = null;

  const screen = root.querySelector<HTMLElement>(".onb-screen");
  if (!screen) return;

  screen.addEventListener("change", (event) => {
    const select = event.target as HTMLSelectElement;
    const key = select.dataset.pick;
    if (!key) return;
    const a = draft.answers;
    const value = select.value;
    switch (key) {
      case "life":
        a.lifeStage = value as LifeStage;
        // A student's income bands are different ones: pick again.
        if (a.incomeRange && !incomeRangesFor(a.lifeStage).some((range) => range.id === a.incomeRange)) {
          delete a.incomeRange;
          delete a.monthlyIncome;
        }
        break;
      case "income":
        if (value === CUSTOM) {
          draft.typing.add("income");
          delete a.incomeRange;
          delete a.monthlyIncome;
        } else {
          draft.typing.delete("income");
          const range = incomeRangesFor(a.lifeStage).find((item) => item.id === value);
          if (range) { a.incomeRange = range.id; a.monthlyIncome = range.estimate; }
        }
        break;
      case "spending":
        if (value === CUSTOM) { draft.typing.add("spending"); delete a.monthlySpending; } else { draft.typing.delete("spending"); a.monthlySpending = Number(value); }
        break;
      case "savings": a.bufferMonthsHave = value as BufferBand; break;
      case "kept": a.cashKeptIn = value as CashKeptIn; break;
      case "want": a.primaryGoal = value as PrimaryGoal; break;
      case "goal":
        if (value === CUSTOM) { draft.typing.add("goal"); delete a.goalAmount; } else { draft.typing.delete("goal"); a.goalAmount = Number(value); }
        break;
      case "invests": a.invests = value === "yes"; break;
    }
    settle();
  });

  // Typed text is kept as it is typed and applied — replies updated, the next
  // sentence shown — on Enter or after a short pause, so the page does not
  // jump mid-word.
  screen.addEventListener("input", (event) => {
    const input = event.target as HTMLInputElement;
    if (input.dataset.amount) {
      const value = parseAmount(input.value);
      const which = input.dataset.amount;
      if (which === "income") { draft.answers.monthlyIncome = value; delete draft.answers.incomeRange; }
      if (which === "spending") draft.answers.monthlySpending = value;
      if (which === "goal") draft.answers.goalAmount = value;
    } else if (input.hasAttribute("data-goal-name")) {
      draft.answers.goalName = input.value.trim().slice(0, 60) || undefined;
    } else {
      return;
    }
    clearTimeout(typingTimer);
    typingTimer = window.setTimeout(() => { if (root.isConnected && draft.screen === "sentences") settle(); }, TYPING_PAUSE_MS);
  });
  screen.querySelectorAll<HTMLInputElement>("input").forEach((input) => input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    clearTimeout(typingTimer);
    settle();
  }));

  screen.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button");
    if (!button || button.disabled) return;
    if (button.dataset.long) {
      const goal = button.dataset.long as LongTermGoal;
      const chosen = new Set(draft.answers.longTermGoals ?? []);
      if (goal === "not-sure") {
        const on = !chosen.has("not-sure");
        chosen.clear();
        if (on) chosen.add("not-sure");
      } else {
        chosen.delete("not-sure");
        if (chosen.has(goal)) chosen.delete(goal); else chosen.add(goal);
      }
      draft.answers.longTermGoals = chosen.size ? LONG_TERM_GOALS.filter((item) => chosen.has(item)) : undefined;
      settle();
      return;
    }
    if (button.dataset.skip) {
      const id = button.dataset.skip as SentenceId;
      for (const key of CLEARS[id]) delete draft.answers[key];
      if (id === "income") draft.typing.delete("income");
      if (id === "spending") draft.typing.delete("spending");
      if (id === "goal") draft.typing.delete("goal");
      draft.skipped.add(id);
      settle();
      return;
    }
    switch (button.dataset.onb) {
      case "start": draft.screen = "sentences"; rerender(); break;
      case "plan": draft.screen = "plan"; rerender(); window.scrollTo(0, 0); break;
      case "back": draft.screen = "sentences"; rerender(); break;
      case "finish": {
        const answers = { ...draft.answers };
        resetOnboardingDraft();
        handlers.onFinish(answers);
        break;
      }
      case "skip-all":
        resetOnboardingDraft();
        handlers.onSkipAll();
        break;
    }
  });
}
