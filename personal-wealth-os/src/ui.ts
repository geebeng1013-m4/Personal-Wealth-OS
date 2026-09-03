import type { WealthState } from "./models";
import { cloneDefaultState, exportState, importStateFromFile, loadSnapshots, restoreSnapshot, clearSnapshots, type Snapshot } from "./state";
import {
  emergencyRatio,
  money,
  percent,
} from "./rules";
import { getPortfolioSnapshot } from "./portfolioSummary";
import { refreshLivePrices, priceRefreshCleanup, PRICE_POLL_INTERVAL_MS } from "./livePrices";
import { getGoalsSnapshot } from "./goalSummary";
import { getBudgetSnapshot } from "./budgetSummary";
import { bindTvmCalculator, tvmCalculatorTemplate } from "./pages/tvmPage";
import { escapeHtml, getTheme } from "./html";
import { mountSideRays } from "./sideRays";

import type { Navigate, Setter } from "./pages/pageTypes";
import { bindReview, reviewTemplate } from "./pages/reviewPage";
import { bindRules, rulesTemplate } from "./pages/rulesPage";
import { bindSettings, settingsTemplate } from "./pages/settingsPage";
import { bindGoals, goalsTemplate } from "./pages/goalsPage";
import { bindBuckets, bucketsTemplate } from "./pages/budgetPage";
import { bindLedger, ledgerTemplate } from "./pages/ledgerPage";
import { bindPortfolio, portfolioTemplate } from "./pages/portfolioPage";
import { bindMarket, marketTemplate } from "./pages/marketPage";
import { bindDashboard, dashboardTemplate } from "./pages/dashboardPage";
import { bindMoneyLeaks, moneyLeaksTemplate, setSelectedMoneyLeakId } from "./pages/moneyLeaksPage";
import { bindAdvisor, advisorPageTemplate } from "./pages/advisorPage";

const sideRaysCleanup = new WeakMap<HTMLElement, () => void>();
const calculatorCleanup = new WeakMap<HTMLElement, () => void>();
const sidebarScrollPositions = new WeakMap<HTMLElement, number>();

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
function shellTemplate(activePage: string, state: WealthState, user?: { displayName?: string | null; email?: string | null; photoURL?: string | null }): string {
  const themeIcon = getTheme() === "dark" ? "☀️" : "🌙";
  const active = pages.find(([id]) => id === activePage);
  const toolsOpen = sidebarToolsOpen();
  const userBadge = user ? `<div class="user-badge"><img src="${escapeHtml(user.photoURL || "")}" alt="" class="user-avatar" referrerpolicy="no-referrer"><span class="user-name">${escapeHtml(user.displayName || user.email || "User")}</span><button class="wu-btn wu-btn--ghost wu-btn--sm logout-btn" type="button">Sign Out</button></div>` : "";
  return `
    <button class="hamburger" id="sidebarToggle" type="button" aria-label="Open navigation" aria-expanded="false">☰</button>
    <div class="sidebar-overlay" id="sidebarOverlay"></div>
    <aside class="sidebar" id="sidebar">
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
      <div class="sidebar-actions">
        ${userBadge}
        <!-- Everything below the account row is occasional: installing the app,
             exporting, restoring a version, resetting. Collapsed by default so
             the sidebar ends on the one row that is always relevant, and the
             Reset button is not sitting under the user's thumb. -->
        <details class="sidebar-tools" id="sidebarTools"${toolsOpen ? " open" : ""}>
          <summary><span>Data &amp; tools</span><span class="sidebar-tools__chevron" aria-hidden="true">›</span></summary>
          <div class="sidebar-tools__content">
            <button class="wu-btn wu-btn--secondary wu-btn--sm wu-btn--block install-btn" id="installPwa" type="button">Add to Home Screen</button>
            <div class="sidebar-actions-row">
              <button class="theme-toggle" id="themeToggle" type="button" aria-label="Toggle color theme" title="Toggle theme">${themeIcon}</button>
              <button class="wu-btn wu-btn--secondary wu-btn--sm" id="exportJson" type="button">Export</button>
              <label class="wu-btn wu-btn--secondary wu-btn--sm file-button">Import<input id="importJson" type="file" accept="application/json"></label>
            </div>
            <div class="sidebar-actions-row">
              <button class="wu-btn wu-btn--secondary wu-btn--sm" id="versionHistory" type="button">Version History</button>
              <button class="wu-btn wu-btn--danger wu-btn--sm" id="resetData" type="button">Reset</button>
            </div>
          </div>
        </details>
      </div>
    </aside>
    <main id="main-content" class="main">
      <div class="side-rays" aria-hidden="true">
        <div class="side-rays-container" id="sideRays"></div>
      </div>
      <header class="topbar">
        <div>
          <span class="eyebrow t-overline">Personal CFO Operating System</span>
          <h2>${active?.[1] ?? "Overview"}<span>${active?.[2] ?? "Dashboard"}</span></h2>
        </div>
      </header>
      <section id="pageMount"></section>
    </main>
  `;
}

/**
 * Whether the sidebar's tools drawer is open.
 *
 * Kept in localStorage rather than in a module variable, because the point of
 * remembering it is to survive a reload — a module variable only lasts until
 * the tab is closed, which is exactly when the preference stops being useful.
 * Every access is guarded: private windows and blocked site data make the
 * accessor itself throw, and a sidebar that cannot render is a worse outcome
 * than a drawer that forgets.
 */
const SIDEBAR_TOOLS_KEY = "wealthup-sidebar-tools-open";

function sidebarToolsOpen(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_TOOLS_KEY) === "true";
  } catch {
    return false;
  }
}

function setSidebarToolsOpen(open: boolean): void {
  try {
    localStorage.setItem(SIDEBAR_TOOLS_KEY, String(open));
  } catch { /* the drawer still works, it just will not be remembered */ }
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

export function quickViewTemplate(state: WealthState): string {
  const portfolio = getPortfolioSnapshot(state);
  const emergency = emergencyRatio(state);
  // PLANNED surplus (allowance minus basic spending), not the recorded
  // income-minus-expenses surplus the Dashboard shows. The label says so:
  // the two are different facts and routinely differ.
  const surplus = getBudgetSnapshot(state).plannedSurplus;
  const investedMyr = portfolio.totalInvestedMyr;
  // Progress uses the canonical currentAmount, so Quick View, the Goals page
  // and the Dashboard can never disagree about how funded a goal is.
  const targetRows = getGoalsSnapshot(state).ordered.map((g) => {
    const pct = Math.round(g.progress * 100);
    return `<div class="wu-list__row"><span>${escapeHtml(g.label)}</span><strong class="t-num${pct >= 80 ? " wu-metric__value--positive" : ""}">${pct}%</strong></div>`;
  }).join("");

  return `
    <div class="wu wu-stack" style="max-width:400px;margin:0 auto">
      <div style="text-align:center">
        <img class="brand-logo brand-logo-dialog" src="/brand/wealthup-logo.png" alt="WEALTHUP Personal Wealth OS">
        <p class="t-caption t-faint">Quick Overview</p>
      </div>

      <div class="wu-grid wu-grid--2">
        <div class="wu-card wu-card--inset wu-card--pad-sm"><div class="wu-metric"><span class="wu-metric__label wu-label">Invested</span><span class="wu-metric__value t-num wu-metric__value--positive">${money(investedMyr)}</span></div></div>
        <div class="wu-card wu-card--inset wu-card--pad-sm"><div class="wu-metric"><span class="wu-metric__label wu-label">Emergency</span><span class="wu-metric__value t-num${emergency >= 0.8 ? " wu-metric__value--positive" : ""}">${percent(emergency)}</span></div></div>
        <div class="wu-card wu-card--inset wu-card--pad-sm"><div class="wu-metric"><span class="wu-metric__label wu-label">Planned Surplus</span><span class="wu-metric__value t-num">${money(surplus)}</span></div></div>
        <div class="wu-card wu-card--inset wu-card--pad-sm"><div class="wu-metric"><span class="wu-metric__label wu-label">DCA / Month</span><span class="wu-metric__value t-num">${money(state.dca.monthly)}</span></div></div>
      </div>

      ${state.goals.length > 0 ? `<div class="wu-card wu-card--inset wu-card--pad-sm"><span class="wu-label">Goals</span><div class="wu-list">${targetRows}</div></div>` : ""}

      <button class="wu-btn wu-btn--primary wu-btn--block" id="openFullApp" type="button">Open Full App</button>
    </div>
  `;
}

export function renderApp(root: HTMLElement, state: WealthState, setState: Setter, activePage = "dashboard", navigate?: Navigate, user?: { displayName?: string | null; email?: string | null; photoURL?: string | null }, onLogout?: () => void): void {
  document.body.classList.toggle("mask-financial-amounts", state.privacy.maskAmounts);
  const currentSidebarScrollArea = root.querySelector<HTMLElement>(".sidebar-scroll-area");
  if (currentSidebarScrollArea) {
    sidebarScrollPositions.set(root, currentSidebarScrollArea.scrollTop);
  }
  const preservedSidebarScrollTop = sidebarScrollPositions.get(root);
  document.body.classList.remove("sidebar-menu-open");
  calculatorCleanup.get(root)?.();
  calculatorCleanup.delete(root);
  sideRaysCleanup.get(root)?.();
  sideRaysCleanup.delete(root);
  priceRefreshCleanup.get(root)?.();
  priceRefreshCleanup.delete(root);

  // Quick view — no sidebar, just condensed data
  if (activePage === "quick") {
    root.className = "app-shell";
    root.innerHTML = '<main class="main quick-view-main">' + quickViewTemplate(state) + '</main>';
    root.querySelector("#openFullApp")?.addEventListener("click", () => {
      renderApp(root, state, setState, "dashboard", navigate, user, onLogout);
    });
    return;
  }

  root.className = "app-shell";
  root.innerHTML = shellTemplate(activePage, state, user);
  const sidebarScrollArea = root.querySelector<HTMLElement>(".sidebar-scroll-area");
  if (sidebarScrollArea) {
    if (preservedSidebarScrollTop !== undefined) {
      sidebarScrollArea.scrollTop = preservedSidebarScrollTop;
    } else {
      keepActiveNavigationVisible(root);
    }
  }
  const sideRays = root.querySelector<HTMLElement>("#sideRays");
  if (sideRays) {
    const cleanup = mountSideRays(sideRays, {
      speed: 2.5,
      rayColor1: "#EAB308",
      rayColor2: "#96c8ff",
      intensity: 2,
      spread: 2,
      origin: "top-right",
      tilt: 0,
      saturation: 1.5,
      blend: 0.75,
      falloff: 1.6,
      opacity: 1,
    });
    sideRaysCleanup.set(root, cleanup);
  }
  const mount = root.querySelector<HTMLElement>("#pageMount");
  if (!mount) return;

  const templates: Record<string, string> = {
    dashboard: dashboardTemplate(state),
    portfolio: portfolioTemplate(state),
    market: marketTemplate(state),
    ledger: ledgerTemplate(state),
    buckets: bucketsTemplate(state),
    goals: goalsTemplate(state),
    tvm: tvmCalculatorTemplate(),
    calculator: '<div id="investmentGrowthCalculator"></div>',
    advisor: advisorPageTemplate(state),
    rules: rulesTemplate(state),
    review: reviewTemplate(state),
    settings: settingsTemplate(state),
    "money-leaks": moneyLeaksTemplate(state),
  };
  mount.innerHTML = templates[activePage] ?? templates.dashboard;

  bindCommon(root, state, setState, navigate, user, onLogout);
  bindPage(root, state, setState, activePage, navigate);
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

function bindCommon(root: HTMLElement, state: WealthState, setState: Setter, navigate?: Navigate, user?: { displayName?: string | null; email?: string | null; photoURL?: string | null }, onLogout?: () => void): void {
  const doNavigate = navigate ?? ((page: string) => renderApp(root, state, setState, page, navigate, user));

  root.querySelectorAll<HTMLButtonElement>(".nav-item").forEach((button) => {
    button.addEventListener("click", () => {
      const scrollArea = root.querySelector<HTMLElement>(".sidebar-scroll-area");
      if (scrollArea) sidebarScrollPositions.set(root, scrollArea.scrollTop);
      closeSidebar(root);
      doNavigate(button.dataset.page ?? "dashboard");
    });
  });

  // Remember whether the tools drawer is open across reloads.
  root.querySelector<HTMLDetailsElement>("#sidebarTools")?.addEventListener("toggle", (event) => {
    setSidebarToolsOpen((event.currentTarget as HTMLDetailsElement).open);
  });

  root.querySelector<HTMLButtonElement>("#themeToggle")?.addEventListener("click", () => {
    const w = window as unknown as Record<string, Record<string, () => void>>;
    w.__pwo?.toggleTheme();
    renderApp(root, state, setState, activePageFromNav(root) ?? "dashboard", navigate, user);
  });

  root.querySelector<HTMLButtonElement>(".logout-btn")?.addEventListener("click", () => {
    onLogout?.();
  });

  // Install PWA button — hide if already standalone
  const installBtn = root.querySelector<HTMLButtonElement>("#installPwa");
  if (installBtn && (window.matchMedia("(display-mode: standalone)").matches || (window.navigator as unknown as { standalone?: boolean }).standalone === true)) {
    installBtn.style.display = "none";
  }
  installBtn?.addEventListener("click", () => {
    (window as unknown as Record<string, () => Promise<void>>).__pwoInstall?.();
  });

  bindSidebar(root);

  root.querySelector<HTMLButtonElement>("#exportJson")?.addEventListener("click", () => {
    if (state.privacy.requireExportConfirmation && !confirm("Export a file containing your financial data? Store it securely.")) return;
    exportState(state);
  });
  root.querySelector<HTMLInputElement>("#importJson")?.addEventListener("change", async (event) => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const imported = await importStateFromFile(file);
    setState(imported);
    doNavigate("dashboard");
  });

  root.querySelector<HTMLButtonElement>("#versionHistory")?.addEventListener("click", () => {
    const snapshots = loadSnapshots(user?.email ?? undefined);
    renderVersionHistoryModal(root, setState, snapshots, navigate, user, onLogout);
  });

  root.querySelector<HTMLButtonElement>("#resetData")?.addEventListener("click", () => {
    if (!confirm("Reset to a blank Personal Wealth OS? Your current data will be saved to Version History first, and can be restored from there.")) return;
    const next = cloneDefaultState();
    // No localStorage.clear() here — this app shares the browser origin with
    // the theme preference, the sidebar's open/closed state and the device id
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
    if (window.matchMedia("(max-width: 720px)").matches) {
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

function renderVersionHistoryModal(root: HTMLElement, setState: Setter, snapshots: Snapshot[], navigate?: Navigate, user?: { displayName?: string | null; email?: string | null; photoURL?: string | null }, onLogout?: () => void): void {
  // Remove existing modal if any
  root.querySelector("#versionHistoryModal")?.remove();

  const uid = user?.email ?? undefined;

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
  modal.style.cssText = "position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;background:var(--surface-overlay);backdrop-filter:blur(4px);";
  modal.innerHTML =
    '<div class="wu-card" style="width:90%;max-width:480px;max-height:80vh;display:flex;flex-direction:column;overflow:hidden;padding:0">' +
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
      setState(restored);
      modal.remove();
      renderApp(root, restored, setState, activePageFromNav(root) ?? "dashboard", navigate, user, onLogout);
    });
  });
}

function activePageFromNav(root: HTMLElement): string | undefined {
  const active = root.querySelector<HTMLButtonElement>(".nav-item.active");
  return active?.dataset?.page;
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
  if (activePage === "tvm") bindTvmCalculator(root);
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
    // PRICE_STALE_AFTER_MS if the page stays open. Re-render the page each
    // time a (re)fetch lands so the holdings table and hero pick up the
    // canonical snapshot's latest valuation.
    const refetchPortfolio = (): void => {
      if (navigate) navigate("portfolio");
      else renderApp(root, state, setState, "portfolio");
    };
    refreshLivePrices(state, refetchPortfolio);
    const portfolioPriceTimer = setInterval(() => refreshLivePrices(state, refetchPortfolio), PRICE_POLL_INTERVAL_MS);
    const onPortfolioVisible = (): void => {
      if (document.visibilityState === "visible") refreshLivePrices(state, refetchPortfolio);
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

