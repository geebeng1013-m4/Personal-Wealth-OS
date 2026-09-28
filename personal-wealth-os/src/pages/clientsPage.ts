/**
 * Advisor view — demo only (D-6).
 *
 * What a financial planner would see across their clients: who needs a call,
 * whose review is overdue, who is on plan. It is a fixed preview, not a
 * feature: there are no advisor accounts, and every figure below is written
 * here. Daniel's row matches his full demo and opens it; the others are
 * sample rows. The page says so, so nobody mistakes it for a working system.
 *
 * It also shows the rule an advisor system would follow: the client cannot
 * change the plan the planner set, only propose a change for them to decide.
 */
import { escapeHtml } from "../html";
import { pageHeader } from "../components/pageHeader";
import { percent } from "../rules";
import type { Navigate } from "./pageTypes";

type ClientStatus = "call" | "watch" | "on-plan";

interface DemoClient {
  name: string;
  /** What the planner calls them. Not always the first word: "Ho Mei Ling" is Mei Ling. */
  calledBy: string;
  age: number;
  goal: string;
  /** Main goal's progress, 0–1. */
  progress: number;
  status: ClientStatus;
  /** Why the status: what the planner would act on. */
  reason: string;
  reviewedDaysAgo: number;
  /** A change to the plan the client asked for, waiting on the planner. */
  proposal?: { change: string; why: string; sentDaysAgo: number };
  /** Only Daniel has the data behind a row. */
  opensDemo?: boolean;
}

const ADVISOR_NAME = "Sarah Wong";
/** A review older than this is due. */
const REVIEW_DUE_DAYS = 60;

// Most urgent first — the order the planner should work through them.
const CLIENTS: DemoClient[] = [
  { name: "Jason Tan", calledBy: "Jason", age: 52, goal: "Retire at 60", progress: 0.41, status: "call", reason: "Card debt up 3 months running", reviewedDaysAgo: 150 },
  { name: "Nurul Aisyah", calledBy: "Nurul", age: 29, goal: "Emergency fund", progress: 0.22, status: "call", reason: "Missed 2 monthly investments", reviewedDaysAgo: 62,
    proposal: { change: "Pause the RM300 monthly investment for 3 months", why: "Car repair this month", sentDaysAgo: 2 } },
  { name: "Ho Mei Ling", calledBy: "Mei Ling", age: 33, goal: "House deposit", progress: 0.35, status: "watch", reason: "Income down this month", reviewedDaysAgo: 42,
    proposal: { change: "House deposit target RM120,000 → RM90,000", why: "Looking at a smaller unit", sentDaysAgo: 5 } },
  { name: "Daniel Lim", calledBy: "Daniel", age: 36, goal: "House deposit", progress: 0.48, status: "on-plan", reason: "On plan", reviewedDaysAgo: 3, opensDemo: true },
  { name: "Kumar Raj", calledBy: "Kumar", age: 45, goal: "Children's university", progress: 0.7, status: "on-plan", reason: "On plan", reviewedDaysAgo: 30 },
];

// A symbol and a word for each status, so colour is never the only signal.
const STATUS_LABEL: Record<ClientStatus, { mark: string; word: string; tone: string }> = {
  call: { mark: "⚠", word: "Needs a call", tone: "t-negative" },
  watch: { mark: "●", word: "Watch", tone: "t-warning" },
  "on-plan": { mark: "✓", word: "On plan", tone: "t-positive" },
};

function reviewedText(days: number): string {
  if (days < 14) return `${days} ${days === 1 ? "day" : "days"} ago`;
  if (days < 56) return `${Math.round(days / 7)} weeks ago`;
  return `${Math.round(days / 30)} months ago`;
}

function clientRow(client: DemoClient, index: number): string {
  const label = STATUS_LABEL[client.status];
  const status = client.status === "on-plan" ? label.word : client.reason;
  return `<li class="wu-client wu-client--${client.status}">
    <button class="wu-client__row" type="button" data-client="${index}">
      <span class="wu-client__name"><span class="${label.tone}" aria-hidden="true">${label.mark}</span> ${escapeHtml(client.name)}<small>Age ${client.age}</small></span>
      <span class="wu-client__goal">${escapeHtml(client.goal)}</span>
      <span class="wu-client__bar"><span class="wu-bar"><span class="wu-bar__fill" style="width:${Math.round(client.progress * 100)}%"></span></span></span>
      <span class="wu-client__pct">${percent(client.progress)}</span>
      <span class="wu-client__status ${label.tone}"><span class="visually-hidden">${label.word}: </span>${escapeHtml(status)}${client.proposal ? `<small class="wu-client__proposal">↳ 1 change to review</small>` : ""}</span>
      <span class="wu-client__review"><span class="wu-client__review-word">Reviewed </span>${reviewedText(client.reviewedDaysAgo)}</span>
      <span class="wu-client__chev" aria-hidden="true">›</span>
    </button>
  </li>`;
}

function proposalItem(client: DemoClient): string {
  if (!client.proposal) return "";
  const { change, why, sentDaysAgo } = client.proposal;
  return `<li class="wu-proposal">
    <p class="wu-proposal__who">${escapeHtml(client.name)} <small>proposed ${reviewedText(sentDaysAgo)}</small></p>
    <p class="wu-proposal__what">${escapeHtml(change)}</p>
    <p class="wu-dash__note">Reason given: ${escapeHtml(why)}</p>
  </li>`;
}

/** `value` is markup: a number span, optionally followed by a wu-money__of span. */
function tile(id: string, label: string, value: string, note: string): string {
  return `<section class="wu-card wu-dash__tile" aria-labelledby="${id}">
    <div class="wu-tc__top"><span class="wu-label" id="${id}">${label}</span></div>
    <p class="wu-money wu-money--md">${value}</p>
    <p class="wu-dash__note">${note}</p>
  </section>`;
}

export function clientsTemplate(): string {
  const needCall = CLIENTS.filter((client) => client.status === "call");
  const reviewsDue = CLIENTS.filter((client) => client.reviewedDaysAgo > REVIEW_DUE_DAYS);
  const onPlan = CLIENTS.filter((client) => client.status === "on-plan");
  const proposing = CLIENTS.filter((client) => client.proposal);
  const firstNames = (list: DemoClient[]) => escapeHtml(list.map((client) => client.calledBy).join(", ")) || "Nobody";

  return `<div class="wu wu-clients-page">
    ${pageHeader({
      eyebrow: `${ADVISOR_NAME} · Financial planner`,
      title: "My clients",
      sub: "Preview of the advisor view. Sample clients and fixed figures; only Daniel Lim opens.",
    })}
    <div class="wu-dash">
      <div class="wu-dash__full wu-dash__tiles wu-clients-tiles">
        ${tile("clientsChangesLabel", "Changes to review", `<span>${proposing.length}</span>`, firstNames(proposing))}
        ${tile("clientsCallLabel", "Need a call", `<span>${needCall.length}</span>`, firstNames(needCall))}
        ${tile("clientsReviewLabel", "Reviews due", `<span>${reviewsDue.length}</span>`, `Last review over ${REVIEW_DUE_DAYS / 30} months ago`)}
        ${tile("clientsPlanLabel", "On plan", `<span>${onPlan.length}</span><span class="wu-money__of">of ${CLIENTS.length}</span>`, firstNames(onPlan))}
      </div>
      <section class="wu-card wu-dash__full wu-stack wu-stack--sm" aria-labelledby="clientsChangesListLabel">
        <div class="wu-tc__top"><span class="wu-label" id="clientsChangesListLabel">Changes to review</span></div>
        <p class="wu-dash__note">Clients cannot change the plan you set. When they want a change, they propose it and you decide.</p>
        <ul class="wu-proposal-list">${proposing.map(proposalItem).join("")}</ul>
      </section>
      <section class="wu-card wu-dash__full wu-stack wu-stack--sm" aria-labelledby="clientsListLabel">
        <div class="wu-tc__top"><span class="wu-label" id="clientsListLabel">Clients · most urgent first</span></div>
        <div class="wu-client__row wu-client__head" aria-hidden="true"><span>Client</span><span>Main goal</span><span>Progress</span><span>%</span><span>Status</span><span>Last review</span><span></span></div>
        <ul class="wu-client-list">${CLIENTS.map(clientRow).join("")}</ul>
        <p class="wu-dash__note" id="clientsNote" role="status" aria-live="polite"></p>
      </section>
    </div>
  </div>`;
}

export function bindClients(root: HTMLElement, navigate: Navigate | undefined): void {
  const note = root.querySelector<HTMLElement>("#clientsNote");
  root.querySelectorAll<HTMLButtonElement>("[data-client]").forEach((button) => button.addEventListener("click", () => {
    const client = CLIENTS[Number(button.dataset.client)];
    if (!client) return;
    if (client.opensDemo) {
      navigate?.("dashboard");
      return;
    }
    if (note) note.textContent = `${client.name} is a sample row. Only Daniel Lim has full data in this demo.`;
  }));
}
