import type { WealthState } from "./models";
import { emptyState, exportState, importStateFromFile, loadSnapshots, restoreSnapshot, clearSnapshots, IMPORT_SNAPSHOT_LABEL, type Snapshot } from "./state";
import { refreshLivePrices, priceRefreshCleanup, PRICE_POLL_INTERVAL_MS } from "./livePrices";
import { bindTvmCalculator, tvmCalculatorTemplate } from "./pages/tvmPage";
import { escapeHtml } from "./html";
import { pageHeader } from "./components/pageHeader";
import { assistantTemplate, mountAssistant } from "./components/assistant/assistantWidget";
import { DISCLAIMER_SHORT } from "./components/disclaimer";
import { createSideRays, type SideRays } from "./sideRays";

import type { Navigate, Setter } from "./pages/pageTypes";
import { bindReview, reviewTemplate } from "./pages/reviewPage";
import { bindRules, rulesTemplate } from "./pages/rulesPage";
import { bindSettings, settingsTemplate } from "./pages/settingsPage";
import { bindGoals, goalsTemplate } from "./pages/goalsPage";
import { bindBuckets, bucketsTemplate } from "./pages/budgetPage";
import { bindLedger, ledgerTemplate } from "./pages/ledgerPage";
import { bindPortfolio, portfolioTemplate, patchPortfolioValuation } from "./pages/portfolioPage";
import { bindMarket, marketTemplate } from "./pages/marketPage";
import { bindDashboard, dashboardTemplate } from "./pages/dashboardPage";
import { runQueuedGuide } from "./onboardingGuide";
import { bindMoneyLeaks, moneyLeaksTemplate, setSelectedMoneyLeakId } from "./pages/moneyLeaksPage";
import { bindAdvisor, advisorPageTemplate } from "./pages/advisorPage";
import { settleTabbarLens } from "./liquidGlass";
import { mountSidebarScrollbar } from "./sidebarScrollbar";
import { mountTitleBar } from "./titleBar";

// Created on the first render that has a shell, then reused by every later
// one (see createSideRays): rebuilding it made the light jump on each click.
let sideRays: SideRays | null = null;
const sidebarScrollbarCleanup = new WeakMap<HTMLElement, () => void>();
const titleBarCleanup = new WeakMap<HTMLElement, () => void>();
const calculatorCleanup = new WeakMap<HTMLElement, () => void>();
const sidebarScrollPositions = new WeakMap<HTMLElement, number>();

/**
 * The signed-in user as the shell sees it. `uid` is what every stored copy of
 * the user's data is keyed by — including Version History — so it is the id to
 * read those copies back with, never the email.
 */
type AppUser = { uid?: string | null; displayName?: string | null; email?: string | null; photoURL?: string | null };

type Page = readonly [id: string, english: string, subtitle: string];
type PageGroup = readonly [title: string, pages: readonly Page[]];

const pageGroups = [
  ["Wealth", [
    ["dashboard", "Overview", "Financial command centre"],
    ["portfolio", "Portfolio", "Investments & activity"],
    ["goals", "Goals", "Progress & targets"],
    ["market", "Market", "Research when needed"],
  ]],
  ["Money", [
    ["ledger", "Ledger", "Income & expenses"],
    ["buckets", "Budget", "Fund allocation"],
    ["money-leaks", "Money Leaks", "Detected cash-flow drag"],
  ]],
  ["Intelligence", [
    ["advisor", "Advisor", "Guidance & scenarios"],
    ["review", "Review", "Monthly check-in"],
    ["rules", "Rules", "Decision framework"],
  ]],
  ["Tools", [
    ["tvm", "TVM Calculator", "Time value of money"],
    ["calculator", "Investment Growth", "Contribution projections"],
  ]],
  ["System", [
    ["settings", "Settings", "Configuration"],
  ]],
] as const satisfies readonly PageGroup[];

const pages: Page[] = pageGroups.flatMap<Page>(([, groupPages]) => [...groupPages]);

/*
 * Bottom tab bar (phone only, see .tabbar in shell.css).
 *
 * On a phone every page change means opening the drawer. Four pages are reached
 * often enough to deserve a permanent thumb-level tab; a fifth "More" button
 * opens the drawer, which holds the full grouped list (Market, Goals, Advisor,
 * …). The drawer is the only navigation chrome on a phone now — the hamburger
 * is hidden. Icons are inline 24-grid SVGs (currentColor) so they inherit the
 * active/idle colour and add no icon dependency.
 */
const TAB_ICONS: Record<string, string> = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 4l9 6.5"/><path d="M5 9.5V20h14V9.5"/></svg>',
  ledger: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2Z"/><path d="M9 8h6M9 12h6"/></svg>',
  portfolio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5 20V11"/><path d="M12 20V4"/><path d="M19 20v-6"/></svg>',
  budget: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/></svg>',
  more: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg>',
};
const primaryTabs: ReadonlyArray<readonly [id: string, label: string, icon: string]> = [
  ["dashboard", "Home", TAB_ICONS.home],
  ["ledger", "Ledger", TAB_ICONS.ledger],
  ["portfolio", "Portfolio", TAB_ICONS.portfolio],
  ["buckets", "Budget", TAB_ICONS.budget],
];

/*
 * Pages the phone "More" list opens — everything without its own bottom tab.
 * The same rule moreTemplate() applies to build the list, named here so the
 * "back to More" arrow and the list can never disagree about which pages sit
 * under More.
 */
const morePageIds = new Set(
  pages.map(([id]) => id).filter((id) => !primaryTabs.some(([tabId]) => tabId === id)),
);

/* Left-pointing chevron for the phone "back to More" control. */
const BACK_TO_MORE_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>';

function backToMoreButton(): string {
  return `<button class="wu-page-back" data-page="more" type="button" aria-label="Back to More"><span aria-hidden="true">${BACK_TO_MORE_ICON}</span></button>`;
}

function tabbarTemplate(activePage: string): string {
  const items = primaryTabs
    .map(([id, label, icon]) => {
      const on = id === activePage;
      return `<button class="tabbar__btn${on ? " is-active" : ""}" data-page="${id}" type="button"${on ? ' aria-current="page"' : ""}><span class="tabbar__icon" aria-hidden="true">${icon}</span><span class="tabbar__label">${label}</span></button>`;
    })
    .join("");
  // "More" is a real page (moreTemplate) listing everything that is not one of
  // the four tabs. It reads as active on its own page and on any page reached
  // from it, so the bar never shows nothing selected.
  const moreActive = !primaryTabs.some(([id]) => id === activePage);
  const more = `<button class="tabbar__btn tabbar__btn--more${moreActive ? " is-active" : ""}" data-page="more" type="button"><span class="tabbar__icon" aria-hidden="true">${TAB_ICONS.more}</span><span class="tabbar__label">More</span></button>`;
  // The lens is the liquid-glass pill under the active tab; liquidGlass.ts
  // slides it over from the previous tab after each render.
  const tabCount = primaryTabs.length + 1;
  return `<nav class="tabbar wu-glass wu-glass--press" aria-label="Primary" style="--tab-count:${tabCount}"><span class="tabbar__lens" aria-hidden="true"></span>${items}${more}</nav>`;
}

/*
 * The "More" page — a Discover-style landing list of every page that does not
 * have its own tab, in the same groups as the desktop sidebar, plus the account
 * row. The data tools (theme, export, import, version history, reset) live on
 * the Settings page. On a phone this replaces the slide-in drawer
 * entirely; the drawer markup stays only for the desktop sidebar.
 */
const MORE_ICONS: Record<string, string> = {
  goals: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5"/></svg>',
  market: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 16l5-5 4 4 7-8"/><path d="M17 7h4v4"/></svg>',
  "money-leaks": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3s6 6.8 6 11a6 6 0 0 1-12 0c0-4.2 6-11 6-11Z"/></svg>',
  advisor: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M15 9l-2 5-4 1 2-5 4-1Z"/></svg>',
  review: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/></svg>',
  rules: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h10M4 12h10M4 18h10"/><path d="M17.5 5l1.5 1.5L22 3.5"/></svg>',
  tvm: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/></svg>',
  calculator: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V4M4 20h16"/><path d="M8 15l4-5 3 2 5-7"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/></svg>',
};

function moreRow(id: string, label: string, sub: string): string {
  return `<button class="more-row" data-page="${id}" type="button">`
    + `<span class="more-row__icon" aria-hidden="true">${MORE_ICONS[id] ?? ""}</span>`
    + `<span class="more-row__text"><span class="more-row__label">${escapeHtml(label)}</span>`
    + (sub ? `<span class="more-row__sub">${escapeHtml(sub)}</span>` : "")
    + `</span><span class="more-row__chev" aria-hidden="true">›</span></button>`;
}

function moreTemplate(user?: AppUser): string {
  const tabIds = new Set(primaryTabs.map(([id]) => id));
  const groups = pageGroups
    .map(([title, groupPages]) => {
      const rows = groupPages
        .filter(([id]) => !tabIds.has(id))
        .map(([id, english, sub]) => moreRow(id, english, sub))
        .join("");
      return rows
        ? `<section class="more-group"><p class="more-group__title t-overline">${escapeHtml(title)}</p><div class="more-group__rows">${rows}</div></section>`
        : "";
    })
    .join("");
  const account = user
    ? `<section class="more-account"><img src="${escapeHtml(user.photoURL || "")}" alt="" class="more-account__avatar" referrerpolicy="no-referrer"><span class="more-account__name">${escapeHtml(user.displayName || user.email || "User")}</span><button class="wu-btn wu-btn--ghost wu-btn--sm logout-btn" type="button">Sign Out</button></section>`
    : "";
  return `<div class="wu">
    ${pageHeader({ title: "More", sub: "Everything else WealthUp does." })}
    <div class="more-list">${groups}${account}</div>
  </div>`;
}

function navTemplate(activePage: string): string {
  let pageIndex = 0;
  return pageGroups
    .map(([groupTitle, groupPages]) => {
      const items = groupPages.map(([id, english, chinese]) => {
        const index = pageIndex++;
        return `<button class="nav-item ${id === activePage ? "active" : ""}" data-page="${id}" type="button" style="--nav-index:${index}"${id === activePage ? ' aria-current="page"' : ""}><i class="nav-node" aria-hidden="true"></i><span class="nav-label"><strong>${english}</strong><small>${chinese}</small></span></button>`;
      }).join("");
      return `<div class="nav-group"><div class="nav-group-title">${groupTitle}</div><div class="nav-group-items">${items}</div></div>`;
    })
    .join("");
}

// Map ticker to TradingView symbol format (EXCHANGE:SYMBOL)
function shellTemplate(activePage: string, state: WealthState, user?: AppUser): string {
  const active = pages.find(([id]) => id === activePage);
  const userBadge = user ? `<div class="user-badge"><img src="${escapeHtml(user.photoURL || "")}" alt="" class="user-avatar" referrerpolicy="no-referrer"><span class="user-name">${escapeHtml(user.displayName || user.email || "User")}</span><button class="wu-btn wu-btn--ghost wu-btn--sm logout-btn" type="button">Sign Out</button></div>` : "";
  return `
    <button class="hamburger" id="sidebarToggle" type="button" aria-label="Open navigation" aria-expanded="false">☰</button>
    <div class="sidebar-overlay" id="sidebarOverlay"></div>
    <aside class="sidebar" id="sidebar">
      <div class="sidebar-scroll">
      <div class="sidebar-scroll-area">
        <div class="brand">
          <span class="brand-mark"><img src="/brand/wealth-mark.png" alt=""></span>
          <span class="brand-copy">
            <h1>WealthUp</h1>
            <p>Personal Wealth OS</p>
          </span>
        </div>
        <nav class="nav line-sidebar" aria-label="Primary navigation">
          ${navTemplate(activePage)}
        </nav>
        <div class="profile-card">
          <span class="eyebrow">Wealth Mandate</span>
          <strong>${escapeHtml(state.profile.riskTolerance)} risk · ${state.profile.investmentHorizonYears}+ years</strong>
          <small>${escapeHtml(state.profile.stage)} · MYR base currency</small>
        </div>
      </div>
      <div class="sidebar-scrollbar" aria-hidden="true" hidden></div>
      </div>
      <div class="sidebar-actions">
        ${userBadge}
        <p class="sidebar-disclaimer">${DISCLAIMER_SHORT}</p>
      </div>
    </aside>
    <main id="main-content" class="main">
      <div class="side-rays" aria-hidden="true">
        <div class="side-rays-container" id="sideRays"></div>
      </div>
      <header class="mobile-brandbar wu-glass wu-glass--bar">
        <span class="mobile-brandbar__mark"><img src="/brand/wealth-mark.png" alt=""></span>
        <span class="mobile-brandbar__name">WealthUp</span>
      </header>
      <div class="titlebar wu-glass wu-glass--bar" aria-hidden="true">
        <strong class="titlebar__title">${active?.[1] ?? "Overview"}</strong>
        <span class="titlebar__sub">${active?.[2] ?? "Dashboard"}</span>
      </div>
      <section id="pageMount"></section>
    </main>
    ${tabbarTemplate(activePage)}
    ${assistantTemplate()}
  `;
}

/**
 * Minimal ActionRecord control for the priority recommendation.
 * Records whether the user acted; it never affects ranking.
 */

/**
 * One Advisor recommendation with its execution state.
 *
 * Wording, severity and order all come from the recommendation itself — this
 * only adds the control for recording that the user acted on it. Completing a
 * recommendation never removes it: the Advisor is a derived read model, so the
 * card stays until the underlying facts change.
 */

export function renderApp(root: HTMLElement, state: WealthState, setState: Setter, activePage = "dashboard", navigate?: Navigate, user?: AppUser, onLogout?: () => void): void {
  document.body.classList.toggle("mask-financial-amounts", state.privacy.maskAmounts);
  const currentSidebarScrollArea = root.querySelector<HTMLElement>(".sidebar-scroll-area");
  if (currentSidebarScrollArea) {
    sidebarScrollPositions.set(root, currentSidebarScrollArea.scrollTop);
  }
  const preservedSidebarScrollTop = sidebarScrollPositions.get(root);
  document.body.classList.remove("sidebar-menu-open");
  calculatorCleanup.get(root)?.();
  calculatorCleanup.delete(root);
  sidebarScrollbarCleanup.get(root)?.();
  sidebarScrollbarCleanup.delete(root);
  titleBarCleanup.get(root)?.();
  titleBarCleanup.delete(root);
  priceRefreshCleanup.get(root)?.();
  priceRefreshCleanup.delete(root);

  root.className = "app-shell";
  root.innerHTML = shellTemplate(activePage, state, user);
  settleTabbarLens(root);
  const sidebarScrollArea = root.querySelector<HTMLElement>(".sidebar-scroll-area");
  if (sidebarScrollArea) {
    if (preservedSidebarScrollTop !== undefined) {
      sidebarScrollArea.scrollTop = preservedSidebarScrollTop;
    } else {
      keepActiveNavigationVisible(root);
    }
  }
  // After the scroll position is restored, so restoring it can't show the thumb.
  sidebarScrollbarCleanup.set(root, mountSidebarScrollbar(root));
  const sideRaysContainer = root.querySelector<HTMLElement>("#sideRays");
  if (sideRaysContainer) {
    // Phones get brighter light (DG-6): the source is tucked under the brand bar.
    const intensity = window.matchMedia("(max-width: 900px)").matches ? 4 : 2.6;
    sideRays ??= createSideRays({
      speed: 2.5,
      // Brand bronze + green (theme.css --c-bronze-400 / --c-green-500), DG-1.
      // blend 0.75 weights rayColor2, so green leads and bronze accents.
      rayColor1: "#c79b57",
      rayColor2: "#57a78f",
      intensity,
      spread: 2,
      origin: "top-right",
      tilt: 0,
      saturation: 1.5,
      blend: 0.75,
      falloff: 1.1,
      opacity: 1,
    });
    sideRays.attach(sideRaysContainer, intensity);
  }
  const mount = root.querySelector<HTMLElement>("#pageMount");
  if (!mount) return;

  const templates: Record<string, string> = {
    dashboard: dashboardTemplate(state, user?.displayName ?? ""),
    portfolio: portfolioTemplate(state),
    market: marketTemplate(state),
    ledger: ledgerTemplate(state),
    buckets: bucketsTemplate(state),
    goals: goalsTemplate(state),
    tvm: tvmCalculatorTemplate(state),
    calculator: `<div class="wu wu-growth-page">${pageHeader({ title: "Investment Growth", sub: "What regular investing could grow to.", actions: '<button class="wu-btn wu-btn--secondary wu-btn--sm" id="growthReset" type="button">Reset</button>' })}</div><div id="investmentGrowthCalculator"></div>`,
    advisor: advisorPageTemplate(state),
    rules: rulesTemplate(state),
    review: reviewTemplate(state),
    settings: settingsTemplate(state),
    "money-leaks": moneyLeaksTemplate(state),
    more: moreTemplate(user),
  };
  mount.innerHTML = templates[activePage] ?? templates.dashboard;

  // On a phone, a page opened from the "More" list gets a back arrow to the
  // left of its title that returns to that list. Desktop opens the same pages
  // from the sidebar, so .wu-page-back stays display:none above the phone
  // breakpoint.
  if (morePageIds.has(activePage)) {
    const headerBar = mount.querySelector(".wu-page-header__bar");
    if (headerBar) {
      headerBar.classList.add("wu-page-header__bar--back");
      headerBar.insertAdjacentHTML("afterbegin", backToMoreButton());
    }
  }

  // After the page content is in, so the bar can find the page header.
  titleBarCleanup.set(root, mountTitleBar(root));

  bindCommon(root, state, setState, navigate, user, onLogout);
  bindPage(root, state, setState, activePage, navigate);

  // Last: the assistant can navigate and pre-fill, so it binds against a page
  // that is already wired up. It lives outside #pageMount and is re-mounted on
  // every render, with its conversation held in module state.
  mountAssistant(root, state, navigate ?? ((page: string) => renderApp(root, state, setState, page, navigate, user, onLogout)));

  // A "Get started" step picked on the Dashboard points at its field here,
  // once this page is fully wired (F-7).
  runQueuedGuide(root, activePage);
}

function keepActiveNavigationVisible(root: HTMLElement): void {
  const scrollArea = root.querySelector<HTMLElement>(".sidebar-scroll-area");
  const activeItem = scrollArea?.querySelector<HTMLElement>(".nav-item.active");
  if (!scrollArea || !activeItem) return;

  const areaRect = scrollArea.getBoundingClientRect();
  const itemRect = activeItem.getBoundingClientRect();
  if (itemRect.top < areaRect.top) {
    scrollArea.scrollTop -= areaRect.top - itemRect.top;
  } else if (itemRect.bottom > areaRect.bottom) {
    scrollArea.scrollTop += itemRect.bottom - areaRect.bottom;
  }
}

function bindCommon(root: HTMLElement, state: WealthState, setState: Setter, navigate?: Navigate, user?: AppUser, onLogout?: () => void): void {
  const doNavigate = navigate ?? ((page: string) => renderApp(root, state, setState, page, navigate, user));

  root.querySelectorAll<HTMLButtonElement>(".nav-item").forEach((button) => {
    button.addEventListener("click", () => {
      const scrollArea = root.querySelector<HTMLElement>(".sidebar-scroll-area");
      if (scrollArea) sidebarScrollPositions.set(root, scrollArea.scrollTop);
      closeSidebar(root);
      doNavigate(button.dataset.page ?? "dashboard");
    });
  });

  // The phone tab bar, the "More" page rows and the back-to-More arrow all
  // navigate by data-page. They live outside the drawer, so there is no sidebar
  // scroll or drawer to touch.
  root.querySelectorAll<HTMLButtonElement>(".tabbar__btn[data-page], .more-row[data-page], .wu-page-back[data-page]").forEach((button) => {
    button.addEventListener("click", () => doNavigate(button.dataset.page ?? "dashboard"));
  });

  // The account row appears in two places (desktop sidebar, phone More page),
  // so bind every match. The data tools live on the Settings page and are found
  // by data-tool, so these handlers follow the buttons wherever they render.
  const bindAll = (selector: string, type: string, handler: (event: Event) => void): void => {
    root.querySelectorAll<HTMLElement>(selector).forEach((el) => el.addEventListener(type, handler));
  };

  bindAll("[data-tool='theme']", "click", () => {
    const w = window as unknown as Record<string, Record<string, () => void>>;
    w.__pwo?.toggleTheme();
    renderApp(root, state, setState, activePageFromNav(root) ?? "dashboard", navigate, user);
  });

  bindAll(".logout-btn", "click", () => {
    onLogout?.();
  });

  // Install PWA button — hide if already standalone.
  const standalone = window.matchMedia("(display-mode: standalone)").matches
    || (window.navigator as unknown as { standalone?: boolean }).standalone === true;
  root.querySelectorAll<HTMLButtonElement>("[data-tool='install']").forEach((btn) => {
    if (standalone) btn.style.display = "none";
    btn.addEventListener("click", () => {
      (window as unknown as Record<string, () => Promise<void>>).__pwoInstall?.();
    });
  });

  bindSidebar(root);

  bindAll("[data-tool='export']", "click", () => {
    if (state.privacy.requireExportConfirmation && !confirm("Export a file containing your financial data? Store it securely.")) return;
    exportState(state);
  });
  bindAll("[data-tool='import']", "change", async (event) => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    // Settings no longer spells out that Import replaces everything, so the
    // confirmation does. Clearing the input lets the same file be picked again.
    if (!confirm("Replace all your data with this file? Your current data will be saved to Version History first.")) {
      input.value = "";
      return;
    }
    const imported = await importStateFromFile(file);
    // The label is what makes this recoverable: saveState snapshots the data
    // still on disk before overwriting it, the same path Reset uses.
    setState(imported, IMPORT_SNAPSHOT_LABEL);
    doNavigate("dashboard");
  });

  bindAll("[data-tool='version']", "click", () => {
    // Copies are written under the user's uid (saveState in main.ts), so they are
    // read back under it. Reading by email found nothing: Version History showed
    // empty for every real account, and the copies Reset and Import take were
    // unreachable.
    const snapshots = loadSnapshots(user?.uid ?? undefined);
    renderVersionHistoryModal(root, setState, snapshots, navigate, user, onLogout);
  });

  bindAll("[data-tool='reset']", "click", () => {
    if (!confirm("Reset to a blank Personal Wealth OS? Your current data will be saved to Version History first, and can be restored from there.")) return;
    // A blank state, as the dialog says — not the sample "Student Investor"
    // template (sample goals, a MYR 400 bear-market reserve) it used to load.
    const next = emptyState();
    // No localStorage.clear() here — this app shares the browser origin with
    // the theme preference and the device id
    // that cloud-sync conflict resolution keys off. Passing a changeLabel is
    // what makes this recoverable: saveState reads the state still on disk
    // before overwriting it and snapshots that copy under the label, the same
    // path every other mutation in this file already goes through.
    setState(next, "Before reset");
    doNavigate("dashboard");
  });
}

function closeSidebar(root: HTMLElement): void {
  root.querySelector<HTMLElement>("#sidebar")?.classList.remove("open");
  root.querySelector<HTMLElement>("#sidebarOverlay")?.classList.remove("visible");
  root.querySelector<HTMLButtonElement>("#sidebarToggle")?.setAttribute("aria-expanded", "false");
  document.body.classList.remove("sidebar-menu-open");
}

function bindSidebar(root: HTMLElement): void {
  const sidebar = root.querySelector<HTMLElement>("#sidebar");
  const overlay = root.querySelector<HTMLElement>("#sidebarOverlay");
  const toggle = root.querySelector<HTMLButtonElement>("#sidebarToggle");
  if (!sidebar || !overlay || !toggle) return;

  const openSidebar = (): void => {
    sidebar.classList.add("open");
    overlay.classList.add("visible");
    toggle.setAttribute("aria-expanded", "true");
    if (window.matchMedia("(max-width: 900px)").matches) {
      document.body.classList.add("sidebar-menu-open");
    }
  };

  toggle.addEventListener("click", () => {
    if (sidebar.classList.contains("open")) closeSidebar(root);
    else openSidebar();
  });
  overlay.addEventListener("click", () => closeSidebar(root));
  root.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !sidebar.classList.contains("open")) return;
    closeSidebar(root);
    toggle.focus();
  });
}

function renderVersionHistoryModal(root: HTMLElement, setState: Setter, snapshots: Snapshot[], navigate?: Navigate, user?: AppUser, onLogout?: () => void): void {
  // Remove existing modal if any
  root.querySelector("#versionHistoryModal")?.remove();

  const uid = user?.uid ?? undefined;

  function formatTime(ts: number): string {
    return new Date(ts).toLocaleString("en-MY", {
      month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true
    });
  }

  const listHtml = snapshots.length === 0
    ? '<p class="wu-empty" style="margin:var(--space-4)">No version history yet. Changes are saved automatically when you modify data.</p>'
    : '<div class="wu-list" style="padding:0 var(--space-5)">' + snapshots.map((snap) =>
      '<div class="wu-list__row history-item">' +
        '<span class="wu-stack wu-stack--sm"><strong class="t-subheading">' + escapeHtml(snap.label) + '</strong><span class="t-caption t-faint">' + formatTime(snap.timestamp) + '</span></span>' +
        '<button class="wu-btn wu-btn--secondary wu-btn--sm restore-snap" data-id="' + snap.id + '" type="button">Restore</button>' +
      '</div>'
    ).join("") + '</div>';

  const modal = document.createElement("div");
  modal.id = "versionHistoryModal";
  modal.className = "wu";
  modal.style.cssText = "position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;background:var(--surface-overlay-glass);";
  modal.innerHTML =
    '<div class="wu-card wu-glass wu-glass--sheet" style="width:90%;max-width:480px;max-height:80vh;display:flex;flex-direction:column;overflow:hidden;padding:0">' +
      '<div class="wu-card__header" style="margin:0;padding:var(--space-4) var(--space-5);border-bottom:1px solid var(--border)">' +
        '<div class="wu-stack wu-stack--sm"><span class="wu-label">Version History</span><strong class="t-heading">📋 Version History</strong></div>' +
        '<div class="wu-row wu-row--tight">' +
          (snapshots.length > 0 ? '<button class="wu-btn wu-btn--danger wu-btn--sm" id="clearAllSnapshots" type="button">Clear All</button>' : '') +
          '<button class="wu-btn wu-btn--ghost wu-btn--icon" id="closeHistoryModal" type="button" aria-label="Close">✕</button>' +
        '</div>' +
      '</div>' +
      '<div style="flex:1;overflow-y:auto;padding:var(--space-3) 0">' + listHtml + '</div>' +
      '<div class="t-caption t-faint" style="padding:var(--space-3) var(--space-5);border-top:1px solid var(--border);text-align:center">' +
        'Auto-saved on every change · Max 20 versions' +
      '</div>' +
    '</div>';

  root.appendChild(modal);

  // Close
  modal.querySelector("#closeHistoryModal")?.addEventListener("click", () => modal.remove());
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.remove(); });

  // Clear all
  modal.querySelector("#clearAllSnapshots")?.addEventListener("click", () => {
    if (!confirm("Clear all version history? This cannot be undone.")) return;
    clearSnapshots(uid);
    modal.remove();
  });

  // Restore
  modal.querySelectorAll<HTMLButtonElement>(".restore-snap").forEach((btn) => {
    btn.addEventListener("click", () => {
      const snapId = btn.dataset.id;
      if (!snapId) return;
      if (!confirm("Restore this version? Your current state will be saved as a snapshot first.")) return;
      const restored = restoreSnapshot(snapId, uid);
      if (!restored) { alert("Snapshot not found."); return; }
      // The dialog above promises the current state is saved first; the label is
      // what does that (saveState snapshots the data on disk before overwriting).
      setState(restored, "Before restore");
      modal.remove();
      renderApp(root, restored, setState, activePageFromNav(root) ?? "dashboard", navigate, user, onLogout);
    });
  });
}

function activePageFromNav(root: HTMLElement): string | undefined {
  // The hash is set on every navigation and is the one source of truth for the
  // current page — the sidebar's .nav-item.active only covers pages that have a
  // sidebar entry (the "More" page, for one, does not). Fall back to it only on
  // a first load with no hash yet.
  const hash = window.location.hash.slice(1);
  if (hash) return hash;
  return root.querySelector<HTMLButtonElement>(".nav-item.active")?.dataset?.page;
}

function bindPage(root: HTMLElement, state: WealthState, setState: Setter, activePage: string, navigate?: Navigate): void {
  root.querySelectorAll<HTMLButtonElement>(".dashboard-nav").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.leakId) setSelectedMoneyLeakId(button.dataset.leakId);
      navigate?.(button.dataset.page ?? "dashboard");
    });
  });

  if (activePage === "dashboard") bindDashboard(root, state, setState, navigate, renderApp);
  if (activePage === "money-leaks") bindMoneyLeaks(root, state, setState, navigate, renderApp);
  if (activePage === "tvm") bindTvmCalculator(root, state);
  if (activePage === "calculator") {
    const mount = root.querySelector<HTMLElement>("#investmentGrowthCalculator");
    if (mount) {
      let cancelled = false;
      calculatorCleanup.set(root, () => {
        cancelled = true;
      });
      import("./calculator/mountCalculator")
        .then(({ mountCalculator }) => {
          if (cancelled || !mount.isConnected) return;
          const unmount = mountCalculator(mount);
          calculatorCleanup.set(root, () => {
            cancelled = true;
            unmount();
          });
        })
        .catch((error: unknown) => {
          console.error("[Calculator] Failed to load", error);
          if (!cancelled && mount.isConnected) {
            mount.innerHTML = '<article class="wu wu-card"><p class="wu-field-row__error" role="alert">Calculator could not be loaded. Please refresh and try again.</p></article>';
          }
        });
    }
  }
  if (activePage === "portfolio") {
    bindPortfolio(root, state, setState, navigate, renderApp);
    // Prices land after the first paint, and go stale after
    // PRICE_STALE_AFTER_MS if the page stays open. On each (re)fetch, repaint
    // only the price-driven regions — the four figure tiles, the holdings,
    // the next-contribution split and the Position Detail rows.
    //
    // This used to re-render the entire #pageMount (and earlier still, a full
    // navigate("portfolio") that also rebuilt the sidebar and WebGL). Both
    // discarded whatever the user had half-typed into the contribution form on
    // every background tick, as often as every PRICE_POLL_INTERVAL_MS.
    // patchPortfolioValuation touches only those display regions — none of
    // which holds an input or a bound control — so nothing the user is
    // interacting with is disturbed and no rebind is needed.
    //
    // Safe to reuse the state captured in this closure rather than reading
    // the caller's current state: every code path that actually changes
    // WealthState pairs its setState call with a full renderApp (see
    // bindPortfolio's own handlers), which tears this closure down and
    // rebinds it with the fresh state. Nothing can mutate WealthState out
    // from under a live price tick without also replacing this closure.
    const repaintPortfolioValuation = (): void => patchPortfolioValuation(root, state);
    refreshLivePrices(state, repaintPortfolioValuation);
    const portfolioPriceTimer = setInterval(() => refreshLivePrices(state, repaintPortfolioValuation), PRICE_POLL_INTERVAL_MS);
    const onPortfolioVisible = (): void => {
      if (document.visibilityState === "visible") refreshLivePrices(state, repaintPortfolioValuation);
    };
    document.addEventListener("visibilitychange", onPortfolioVisible);
    priceRefreshCleanup.set(root, () => {
      clearInterval(portfolioPriceTimer);
      document.removeEventListener("visibilitychange", onPortfolioVisible);
    });
  }
  if (activePage === "advisor") bindAdvisor(root, state, setState, navigate, renderApp);
  if (activePage === "review") bindReview(root, state, setState, navigate, renderApp);
  if (activePage === "settings") bindSettings(root, state, setState, navigate, renderApp);
  if (activePage === "goals") bindGoals(root, state, setState, navigate, renderApp);
  if (activePage === "market") bindMarket(root, state, setState);
  if (activePage === "ledger") bindLedger(root, state, setState, navigate, renderApp);
  if (activePage === "buckets") bindBuckets(root, state, setState, navigate, renderApp);
  if (activePage === "rules") bindRules(root, state, setState, navigate, renderApp);
}

