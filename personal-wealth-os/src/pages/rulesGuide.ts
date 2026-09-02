/**
 * The "How WealthUp works" panel on the Rules page.
 *
 * Static authored copy for someone opening the app for the first time — what
 * it is, what each page is for, the two things that are easy to get wrong, and
 * an order to do things in. It sits beside the user's own rule cards because
 * both answer the same question: what governs a decision here.
 *
 * Nothing on this panel reads state, so nothing here needs escaping. If that
 * ever changes, every interpolated value must go through escapeHtml.
 */

type GuideRow = { page: string; text: string };

const WEALTH: GuideRow[] = [
  { page: "Overview", text: "Your home page. What you're worth, how this month went, how healthy you are overall, whether you're keeping to the plan, and the single most important thing to do next." },
  { page: "Portfolio", text: "Your investments — what they're worth, how your allocation compares to your targets, and where you record or import each contribution." },
  { page: "Goals", text: "What you're saving for and how close you are. A goal can follow a real account's balance, or track a number you update yourself." },
  { page: "Market", text: "Research one holding at a time: price, your position, risk, dividends, what the fund holds, a side-by-side comparison — and how far this asset has fallen in the past." },
];

const MONEY: GuideRow[] = [
  { page: "Ledger", text: "Where you record income and expenses. This is the foundation — almost every other number is built from it." },
  { page: "Budget", text: "Split your monthly money into buckets. What you planned sits beside what the ledger actually recorded, and the two are never mixed." },
  { page: "Money Leaks", text: "Scans for money quietly draining away — subscriptions, fees, duplicate charges, spending creeping up, budget drift, stalled goals, debt drag." },
];

const PLAN: GuideRow[] = [
  { page: "Rules", text: "Your decision framework: how much to invest, how much cash to hold, what allocation to keep, and what to do in a downturn. The Advisor checks your finances against exactly these." },
  { page: "Advisor", text: "Guidance based on the rules above. Every recommendation shows what it noticed, why it matters, and one thing to do. It also holds your dip-buy ladder." },
  { page: "Review", text: "A monthly check-in, pre-filled with that month's income, spending and what you actually invested — so you confirm figures rather than dig for them." },
];

const TOOLS: GuideRow[] = [
  { page: "TVM Calculator", text: "Give it any four of present value, payment, future value, rate and periods, and it solves for the fifth." },
  { page: "Investment Growth", text: "The same idea as a chart: see a projection split into what you put in and what the growth added." },
];

function rowList(rows: GuideRow[]): string {
  return `<dl class="wu-list">${rows.map((row) => `<div class="wu-list__row guide-row">
    <dt class="t-subheading">${row.page}</dt>
    <dd class="t-body-sm t-muted">${row.text}</dd>
  </div>`).join("")}</dl>`;
}

function section(label: string, title: string, rows: GuideRow[]): string {
  return `<article class="wu-card">
    <div class="wu-card__header">
      <div class="wu-stack wu-stack--sm"><span class="wu-label">${label}</span><h3 class="wu-card__title t-heading">${title}</h3></div>
    </div>
    ${rowList(rows)}
  </article>`;
}

export function rulesGuideTemplate(): string {
  return `<div class="wu-stack wu-stack--lg rules-guide">
    <article class="wu-card wu-card--accent">
      <div class="wu-card__header">
        <div class="wu-stack wu-stack--sm"><span class="wu-label">Start here</span><h3 class="wu-card__title t-heading">What WealthUp does</h3></div>
      </div>
      <p class="t-body">WealthUp keeps your whole financial picture in one place: what you earn and spend, what you've invested, what you're saving for, and whether you're actually following your own plan. Amounts are in ringgit; your investments can be in dollars.</p>
      <dl class="wu-list">
        <div class="wu-list__row guide-row"><dt class="t-subheading">It doesn't predict</dt><dd class="t-body-sm t-muted">No forecasts, no market calls. Everything it tells you comes from what you've recorded plus rules you set yourself.</dd></div>
        <div class="wu-list__row guide-row"><dt class="t-subheading">It doesn't trade</dt><dd class="t-body-sm t-muted">Nothing is ever bought or sold for you. It records what you did and tells you what your own rules say about it.</dd></div>
        <div class="wu-list__row guide-row"><dt class="t-subheading">It doesn't guess</dt><dd class="t-body-sm t-muted">When a figure genuinely isn't known it shows <strong class="t-num">--</strong> rather than quietly using zero.</dd></div>
      </dl>
    </article>

    ${section("Wealth", "Where your money stands", WEALTH)}
    ${section("Money", "What comes in and goes out", MONEY)}
    ${section("Intelligence", "Staying on plan", PLAN)}
    ${section("Tools", "Thinking it through", TOOLS)}

    <article class="wu-card wu-card--warning">
      <div class="wu-card__header">
        <div class="wu-stack wu-stack--sm"><span class="wu-label">Worth knowing</span><h3 class="wu-card__title t-heading">Two things that surprise people</h3></div>
      </div>
      <dl class="wu-list">
        <div class="wu-list__row guide-row">
          <dt class="t-subheading">Record your currency conversions</dt>
          <dd class="t-body-sm t-muted">Buying US shares with ringgit is two separate events — converting, then buying — and your broker's export only knows about the dollars. The exchange rate you actually got isn't in it. Paste your exchange history into Portfolio → Currency conversions and the ringgit cost of every holding becomes real instead of estimated.</dd>
        </div>
        <div class="wu-list__row guide-row">
          <dt class="t-subheading">The dip-buy ladder is a record, not an alarm</dt>
          <dd class="t-body-sm t-muted">It marks which of your drawdown steps have been reached, but nothing runs while the app is closed and there are no push notifications. A reached step is flagged on your Overview the next time you open it, and only counts once you mark it as deployed.</dd>
        </div>
      </dl>
    </article>

    <article class="wu-card">
      <div class="wu-card__header">
        <div class="wu-stack wu-stack--sm"><span class="wu-label">Getting set up</span><h3 class="wu-card__title t-heading">A good first hour</h3></div>
        <span class="wu-badge wu-badge--neutral">6 steps</span>
      </div>
      <div class="wu-stack">
        <ol class="wu-stack wu-stack--sm guide-steps">
          <li class="t-body-sm"><strong class="t-subheading">Settings</strong> — your income, regular expenses and any debts.</li>
          <li class="t-body-sm"><strong class="t-subheading">Rules</strong> — your monthly investing amount, emergency fund target and target allocation. Everything the Advisor says depends on these.</li>
          <li class="t-body-sm"><strong class="t-subheading">Ledger</strong> — add your accounts, then record this month's income and spending.</li>
          <li class="t-body-sm"><strong class="t-subheading">Portfolio</strong> — record what you already hold, or import it. If you invest in US shares, add your currency conversions too.</li>
          <li class="t-body-sm"><strong class="t-subheading">Goals</strong> — add one thing you're saving for.</li>
          <li class="t-body-sm"><strong class="t-subheading">Overview</strong> — now it has something to tell you.</li>
        </ol>
        <p class="t-caption t-faint">You can stop after step 3 and still get real use out of it. Steps 4 and 5 are what turn it from an expense tracker into a full picture.</p>
      </div>
    </article>

    <article class="wu-card">
      <div class="wu-card__header">
        <div class="wu-stack wu-stack--sm"><span class="wu-label">Your data</span><h3 class="wu-card__title t-heading">Where it lives</h3></div>
      </div>
      <dl class="wu-list">
        <div class="wu-list__row guide-row"><dt class="t-subheading">Sync</dt><dd class="t-body-sm t-muted">Signing in with Google syncs across your devices. It works offline too — anything already saved stays readable, and the app says plainly when it can't reach the network rather than pretending it synced.</dd></div>
        <div class="wu-list__row guide-row"><dt class="t-subheading">Export &amp; history</dt><dd class="t-body-sm t-muted">Data &amp; tools in the sidebar holds export, import, and version history — snapshots taken as you change things, so you can roll back.</dd></div>
        <div class="wu-list__row guide-row"><dt class="t-subheading">Privacy</dt><dd class="t-body-sm t-muted">Settings has a toggle that blurs every amount on screen, for when someone's looking over your shoulder.</dd></div>
      </dl>
    </article>
  </div>`;
}
