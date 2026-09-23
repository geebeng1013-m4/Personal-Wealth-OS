// Fonts ship with the app instead of from Google Fonts: the stylesheet link in
// index.html blocked the first paint, and where Google is unreachable the page
// stayed blank until the request timed out. Bundled, they also get the
// long-lived cache every /assets file has.
import "@fontsource-variable/inter/wght.css";
import "@fontsource/geist-mono/400.css";
import "@fontsource/geist-mono/500.css";
import "@fontsource/geist-mono/600.css";
import "@fontsource/lato/400.css";
import "./theme.css";
import "./components.css";
import "./shell.css";
import "./components/assistant/assistant.css";
import "./legacy-tail.css";
import type { WealthState } from "./models";
import { loadState, saveState, loadStateFromCloud, syncLocalToCloud, emptyState, migrateState, reconcileCloudSnapshot, recordCloudSyncPoint, adoptRemoteState, createId, cloudLoadNeedsRender } from "./state";
import { renderApp } from "./ui";
import { onAuth, preloadFirestore, signInWithGoogle, handleRedirectResult, logOut, subscribeToFirestore, loadAssistantHistory, saveAssistantHistory, type CloudSnapshot } from "./firebase";
import { setAssistantOwner } from "./components/assistant/assistantStore";
import { flushAssistantSync, startAssistantSync, stopAssistantSync } from "./components/assistant/assistantSync";
import { fetchUsdToMyr, pruneMarketCache } from "./market";
import type { User } from "firebase/auth";
import { isDemoMode } from "./demo";
import { demoStateFor, DEMO_USER_DISPLAY_NAME, DEMO_USER_EMAIL, DEMO_USER_PHOTO } from "./demoData";
import { initSaveErrorToasts } from "./components/toast";
import { initLiquidGlass } from "./liquidGlass";
import { applyOnboardingAnswers, shouldShowOnboardingQuiz, skipOnboardingQuiz } from "./onboardingQuiz";
import { renderOnboarding, resetOnboardingDraft } from "./pages/onboardingPage";
import { mountPageScrollbar } from "./overlayScrollbar";
import { startFigureFitting } from "./components/fitFigures";

// Drop stale cached ticker data from previous sessions so localStorage doesn't grow unbounded.
pruneMarketCache();

// Surface the pwo-save-error events state.ts already dispatches — without this
// a failed write (quota, blocked storage, rejected sync) is completely silent.
initSaveErrorToasts();
initLiquidGlass();
mountPageScrollbar();
startFigureFitting();

// PWA install prompt
let deferredPrompt: BeforeInstallPromptEvent | null = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e as BeforeInstallPromptEvent;
});
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: string }>;
}

function isIOS(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function isStandalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches || (window.navigator as unknown as { standalone?: boolean }).standalone === true;
}

function showIOSInstructions(): void {
  const overlay = document.createElement("div");
  // Thick glass sheet on a light dim, like Version History (DG-3 / DG-7).
  overlay.style.cssText = "position:fixed;inset:0;background:var(--surface-overlay-glass);z-index:9999;display:flex;align-items:center;justify-content:center;padding:24px;";
  overlay.innerHTML = `
    <div class="wu wu-card wu-glass wu-glass--sheet" style="max-width:320px;text-align:center;">
      <h3 class="t-heading" style="margin:0 0 16px;">Install Wealth OS</h3>
      <div class="t-body-sm t-muted" style="text-align:left;line-height:1.8;">
        <p>1. Tap the <strong>Share</strong> button <span style="font-size:18px;">⬆️</span> at the bottom of Safari</p>
        <p>2. Scroll down and tap <strong>"Add to Home Screen"</strong></p>
        <p>3. Tap <strong>"Add"</strong> in the top right</p>
      </div>
      <button class="wu-btn wu-btn--secondary wu-btn--sm" id="closeInstallGuide" style="margin-top:16px;">Got it</button>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector("#closeInstallGuide")?.addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
}

async function handleInstall(): Promise<void> {
  if (isStandalone()) {
    alert("Already installed!");
    return;
  }
  if (isIOS()) {
    showIOSInstructions();
    return;
  }
  if (deferredPrompt) {
    await deferredPrompt.prompt();
    const result = await deferredPrompt.userChoice;
    deferredPrompt = null;
    if (result.outcome === "accepted") {
      console.log("[PWA] Installed");
    }
  } else {
    alert("Install not available. Try opening in Chrome on Android, or use Safari on iOS.");
  }
}

// Expose install handler globally
(window as unknown as Record<string, unknown>).__pwoInstall = handleInstall;

const root = document.querySelector<HTMLElement>("#app");

if (!root) {
  throw new Error("Missing #app root element.");
}

// Theme management
type Theme = "dark" | "light";

/** The sign-in page's ground, kept in step with `.login-shell` in shell.css. */
const LOGIN_BG = "#050706";

function getStoredTheme(): Theme {
  const t = localStorage.getItem("pwo-theme");
  if (t === "light" || t === "dark") return t;
  // First load: light, whatever the OS prefers. Once the user toggles, the
  // stored value wins. Kept identical to the boot script in index.html — the
  // two disagreeing would repaint the page after first paint.
  return "light";
}

/**
 * Tints the phone's status strip (index.html #app-theme-color).
 *
 * The sign-in page is dark in both themes, so it names its own colour instead
 * of the theme's — otherwise a light theme tints the strip sand over a near
 * black page.
 *
 * Held back until the launch overlay has gone. iOS colours the strip behind
 * the home indicator from the page, so a light tint written while the dark W
 * is still up shows as a sand band under it (#125 did exactly that, undoing
 * #121). The meta starts launch-dark; the boot script says when it may move.
 */
let pendingThemeColor: string | null = null;

function launchIsDone(): boolean {
  return document.documentElement.classList.contains("launch-done");
}

function flushThemeColor(): void {
  if (pendingThemeColor === null || !launchIsDone()) return;
  const meta = document.querySelector<HTMLMetaElement>("#app-theme-color");
  if (meta) meta.content = pendingThemeColor;
}

// The boot script fires this when it retires #launch. Checking the class as
// well covers the case where it had already retired before this module ran —
// with no #launch in the document it retires immediately.
document.addEventListener("pwo-launch-done", flushThemeColor);

function setThemeColor(color: string): void {
  pendingThemeColor = color;
  flushThemeColor();
}

function themeColor(theme: Theme): string {
  return theme === "light" ? "#f4f1ea" : "#141310";
}

function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
  setThemeColor(themeColor(theme));
  localStorage.setItem("pwo-theme", theme);
}

// Initialize theme
applyTheme(getStoredTheme());

let state: WealthState = loadState(); // Initial load without UID (will be replaced on auth)
const appPages = new Set([
  "dashboard",
  "portfolio",
  "market",
  "ledger",
  "buckets",
  "goals",
  "tvm",
  "calculator",
  "advisor",
  "rules",
  "review",
  "me",
  "settings",
  "money-leaks",
  "more",
]);

function pageFromLocation(): string {
  // Quick View is gone. Bookmarks to /quick and home-screen icons installed
  // with the old start_url (/#quick) still open, and land on the Overview.
  if (window.location.pathname === "/quick" || window.location.hash === "#quick") {
    const hash = window.location.hash === "#quick" ? "#dashboard" : window.location.hash;
    window.history.replaceState(null, "", `/${hash}`);
  }
  const hashPage = window.location.hash.slice(1);
  return appPages.has(hashPage) ? hashPage : "dashboard";
}

function rememberPage(page: string): void {
  const nextHash = `#${page}`;
  if (window.location.hash !== nextHash) {
    window.history.replaceState(null, "", nextHash);
  }
}

let currentPage = pageFromLocation();
let currentUser: User | null = null;
let cloudSyncUnsub: (() => void) | null = null;
let authRequestId = 0;
/**
 * The new-user Q&A (O-2) may only open once this account is known to be new:
 * its data is already on this device, or the cloud has answered. Until then an
 * empty local state could just be a returning user on a new device.
 */
let quizAllowed = false;

// Expose theme toggle and page nav globally
(window as unknown as Record<string, unknown>).__pwo = {
  toggleTheme: () => {
    const current = getStoredTheme();
    applyTheme(current === "dark" ? "light" : "dark");
  },
  navigate: (page: string) => {
    navigate(page);
  },
};

function setState(next: WealthState, changeLabel?: string): void {
  state = next;
  // Only persist if a user is logged in (prevent saving to global key)
  const user = currentUser;
  if (user) {
    // Adopt the saved copy, not `next`: saveState stamps `updatedAt` on a copy
    // of its own, and handleCloudSnapshot matches that value against the one
    // the server echoes back to decide the write is confirmed. Keeping `next`
    // here leaves the two permanently apart, so the confirmation is never
    // recognised and the device stays "dirty" forever (see saveState).
    state = saveState(next, user.uid, changeLabel) ?? next;
  }
}

function navigate(page: string): void {
  currentPage = appPages.has(page) ? page : "dashboard";
  rememberPage(currentPage);
  renderApp(root!, state, setState, currentPage, navigate, currentUser ?? undefined, handleLogout);
}

/** The signed-in screen: the first-run Q&A for an untouched new account, otherwise the app. */
function renderSignedIn(user: User): void {
  // Whatever brought us here, the screen is about to show the current `state`.
  screenIsStale = false;
  setThemeColor(themeColor(getStoredTheme()));
  if (!quizAllowed || !shouldShowOnboardingQuiz(state)) {
    renderApp(root!, state, setState, currentPage, navigate, user, handleLogout);
    return;
  }
  const enterApp = () => {
    currentPage = "dashboard";
    rememberPage(currentPage);
    renderApp(root!, state, setState, currentPage, navigate, user, handleLogout);
    window.scrollTo(0, 0);
  };
  // The user's own calendar day (YYYY-MM-DD), not UTC's.
  const today = () => new Date().toLocaleDateString("en-CA");
  renderOnboarding(root!, {
    userName: user.displayName ?? "",
    onFinish: (answers) => {
      // One save for every answer: a single undo point in version history.
      setState(applyOnboardingAnswers(state, answers, { goalId: createId("goal"), today: today() }), "Set up your plan");
      enterApp();
    },
    onSkipAll: () => {
      setState(skipOnboardingQuiz(state, today()), "Skipped the setup questions");
      enterApp();
    },
  });
}

async function handleLogout(): Promise<void> {
  if (cloudSyncUnsub) { cloudSyncUnsub(); cloudSyncUnsub = null; }
  // A change made in the last moment before signing out still reaches the cloud.
  await flushAssistantSync();
  await logOut();
}

/**
 * Live subscription to the user's cloud document.
 *
 * The initial reconcile in handleAuth is a one-shot getDoc. This keeps the app
 * converged after that: it records a sync point when the server confirms this
 * device's own write (so lastSyncedAt advances and the copy is marked clean),
 * re-pushes local when another device's change collides with unsynced local
 * edits, and — see handleRemoteUpdate — surfaces a genuine remote change the
 * user has not seen.
 */
function startCloudSubscription(uid: string): void {
  if (cloudSyncUnsub) { cloudSyncUnsub(); cloudSyncUnsub = null; }
  cloudSyncUnsub = subscribeToFirestore(uid, (snap) => handleCloudSnapshot(uid, snap));
}

function handleCloudSnapshot(uid: string, snap: CloudSnapshot): void {
  if (currentUser?.uid !== uid) return;
  const remote = migrateState(snap.state);
  const action = reconcileCloudSnapshot(state, {
    updatedAt: remote.updatedAt,
    hasPendingWrites: snap.hasPendingWrites,
    fromCache: snap.fromCache,
  });

  if (action === "ignore") return;

  if (action === "record-sync-point") {
    const marked = recordCloudSyncPoint(uid, state.updatedAt);
    if (marked) state = marked;
    return;
  }

  if (action === "push-local") {
    // Another device wrote, but this device has edits the server never got.
    // Keep what is on screen and push it up; last-writer-wins at Firestore.
    console.warn("[Sync] Remote change collided with unsynced local edits — keeping local and re-pushing.");
    void syncLocalToCloud(state);
    return;
  }

  // action === "apply-remote": another device changed the data, this device is
  // clean, and the remote copy is not older than this one — reconcileCloudSnapshot
  // checks that last part, which this comment once only assumed. Adopt it —
  // memory and local storage both, snapshotting what it replaces — and put it on
  // screen at the next moment that will not interrupt the user.
  state = adoptRemoteState(uid, remote);
  screenIsStale = true;
  const user = currentUser;
  if (user) showCurrentStateWhenUndisturbed(user);
}

/**
 * True while the screen is older than `state` — a change from another device
 * has been adopted but not yet drawn.
 */
let screenIsStale = false;

/**
 * Draw the current state, unless doing so would interrupt the user.
 *
 * renderApp replaces root.innerHTML wholesale (see ui.ts), so rebuilding while
 * a field has focus throws away half-entered input and the caret with it, and
 * the ledger's entry form only captures its draft when the type is switched.
 * A change from another device is never worth that, so the rebuild waits for a
 * moment when nothing inside the app holds focus.
 *
 * Nothing is lost by waiting: `state` and local storage already hold the
 * remote copy, so an edit made on the stale screen is applied on top of it,
 * and that edit's own re-render shows both.
 */
function showCurrentStateWhenUndisturbed(user: User): void {
  if (!screenIsStale) return;
  const focused = document.activeElement;
  if (root && focused instanceof HTMLElement && focused !== root && root.contains(focused)) return;
  // A rebuild starts the page from the top; the reader was not necessarily there.
  const scrollY = window.scrollY;
  renderSignedIn(user);
  window.scrollTo(0, scrollY);
}

// Catching up a screen that stayed stale: when the user comes back to this
// device (tab visible again, window refocused) and after any click, which runs
// late enough that the app's own handlers — and any re-render they already
// did — have gone first.
function catchUpStaleScreen(): void {
  if (!screenIsStale || document.visibilityState !== "visible") return;
  const user = currentUser;
  if (user) showCurrentStateWhenUndisturbed(user);
}

document.addEventListener("visibilitychange", catchUpStaleScreen);
window.addEventListener("focus", catchUpStaleScreen);
document.addEventListener("click", () => { setTimeout(catchUpStaleScreen, 0); });

// A hint, not a credential: it only decides what shows while Firebase checks
// the real session. index.html reads the same key to pick its skeleton.
const SIGNED_IN_HINT_KEY = "wealthup-signed-in";

function wasSignedIn(): boolean {
  try {
    return localStorage.getItem(SIGNED_IN_HINT_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberSignedIn(signedIn: boolean): void {
  try {
    if (signedIn) localStorage.setItem(SIGNED_IN_HINT_KEY, "1");
    else localStorage.removeItem(SIGNED_IN_HINT_KEY);
  } catch {
    // Storage blocked: the next load just shows the login page first, as before.
  }
}

function renderLogin(): void {
  setThemeColor(LOGIN_BG);
  document.body.classList.toggle("mask-financial-amounts", state.privacy.maskAmounts);
  root!.className = "login-shell";
  root!.innerHTML = `
    <div class="login-container">
      <div class="login-card">
        <div class="login-brand">
          <div class="login-logo-frame">
            <img class="brand-logo-login" src="/brand/wealth-mark.png" alt="WealthUp">
          </div>
          <div class="login-brand-copy">
            <h1>WealthUp</h1>
          </div>
          <p class="login-tagline">Track <span aria-hidden="true">•</span> Grow <span aria-hidden="true">•</span> Compound</p>
        </div>
        <div class="login-body">
          <div class="login-pitch">
            <h2>Your money, investments and goals, all in one place.</h2>
          </div>
          <button class="google-signin-btn" id="googleSignIn" type="button">
            <svg viewBox="0 0 24 24" width="20" height="20"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
            <span>Sign in with Google</span>
          </button>
          <p class="login-desc">Free. Your data stays private to you.<br>For guidance only, not financial advice.</p>
        </div>
      </div>
      <!-- F-8: what WealthUp is, for a visitor deciding whether to sign in.
           Beside the card on a wide screen, below it on a phone, so the
           button stays in the first view. -->
      <section class="login-features" aria-labelledby="loginFeaturesTitle">
        <h2 class="visually-hidden" id="loginFeaturesTitle">What WealthUp does</h2>
        <ul>
          <li><strong>See your real net worth</strong><span>Bank, e-wallet and brokerage in one number, in MYR.</span></li>
          <li><strong>Know your real returns</strong><span>Fees, FX and dividends included, not just the price change.</span></li>
          <li><strong>Stay on plan</strong><span>A safety buffer, goals and simple rules that tell you what to do next.</span></li>
        </ul>
      </section>
    </div>
  `;

  root!.querySelector<HTMLButtonElement>("#googleSignIn")?.addEventListener("click", async (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");

    try {
      const user = await signInWithGoogle();
      if (import.meta.env.DEV) {
        console.log(user ? "[Auth] Sign-in successful via popup" : "[Auth] Redirecting to Google sign-in...");
      }
    } catch (err) {
      console.error("Sign-in failed:", err);
      alert("Sign-in failed. Please try again.");
      button.disabled = false;
      button.removeAttribute("aria-busy");
    }
  });
}

async function handleAuth(user: User | null): Promise<void> {
  const requestId = ++authRequestId;
  rememberSignedIn(user !== null);

  if (user) {
    currentUser = user;
    preloadFirestore();
    console.log(`[Auth] User signed in: ${user.uid} (${user.email})`);

    // Unsubscribe from previous cloud sync if any
    if (cloudSyncUnsub) { cloudSyncUnsub(); cloudSyncUnsub = null; }

    // The assistant's history is this account's, and nobody else's — here and
    // on the account's other devices.
    setAssistantOwner(user.uid);
    void startAssistantSync(user.uid, { load: loadAssistantHistory, save: saveAssistantHistory });

    const userStorageKey = `personal-wealth-os-state-${user.uid}`;
    const hasLocalData = localStorage.getItem(userStorageKey) !== null;
    quizAllowed = hasLocalData;

    // Show the user-specific local state immediately. Cloud access can be slow,
    // unavailable offline, or denied without preventing access to saved data.
    state = loadState(user.uid);
    renderSignedIn(user);

    // Warm the exchange rate cache early so the dashboard renders with current
    // rates — and hand it the user's own conversions, so a failed request falls
    // back on a rate they really got rather than on a hard-coded constant.
    void fetchUsdToMyr(state.trades, state.currencyExchanges).catch(() => {});

    try {
      const cloud = await loadStateFromCloud();
      if (requestId !== authRequestId || currentUser?.uid !== user.uid) return;
      quizAllowed = true;

      if (cloud.outcome === "cloud-applied") {
        // The same save as the one already rendered from local storage: adopt
        // it (its sync point is now confirmed) without rebuilding the screen.
        const needsRender = cloudLoadNeedsRender(state, cloud.state);
        state = cloud.state;
        if (needsRender) renderSignedIn(user);
      } else if (cloud.outcome === "local-kept-newer") {
        // This device holds edits the cloud has never seen — it was offline, or
        // the write was rejected. Keep them on screen and push them up, rather
        // than letting the older cloud document overwrite work the user did.
        console.warn("[Auth] Local data is newer than the cloud copy; keeping local and syncing it up.");
        state = cloud.state;
        renderSignedIn(user);
        await syncLocalToCloud(state);
      } else if (hasLocalData) {
        // User has local data from before, sync it up
        await syncLocalToCloud(state);
      } else {
        // Brand new user — push fresh empty state to cloud
        state = emptyState();
        state = saveState(state, user.uid) ?? state;
        await syncLocalToCloud(state);
        if (requestId !== authRequestId || currentUser?.uid !== user.uid) return;
        renderSignedIn(user);
      }
    } catch (err) {
      // A failed read is not the same as an empty cloud document. Keep the local
      // state and never overwrite cloud data when connectivity or permissions fail.
      console.error("[Auth] Cloud load failed, continuing with local state:", err);
    }

    if (requestId === authRequestId && currentUser?.uid === user.uid) {
      startCloudSubscription(user.uid);
    }

  } else {
    currentUser = null;
    // Clear in-memory state to prevent leaking to next user
    state = emptyState();
    resetOnboardingDraft();
    stopAssistantSync();
    setAssistantOwner(null);
    if (cloudSyncUnsub) { cloudSyncUnsub(); cloudSyncUnsub = null; }
    renderLogin();
  }
}

// --- Demo mode: skip Firebase, load static demo data ---
if (isDemoMode()) {
  console.log("[Demo] Design Review mode — Firebase auth and writes are disabled.");
  // `?fresh` starts an empty account, to walk the new-user Q&A (O-2). It keeps
  // its own storage so it never touches the fixture the plain demo shows.
  const fresh = new URLSearchParams(window.location.search).has("fresh");
  // Create a minimal mock user so the UI renders normally without real auth.
  const demoUser = {
    uid: fresh ? "demo-fresh-user" : "demo-user",
    displayName: DEMO_USER_DISPLAY_NAME,
    email: DEMO_USER_EMAIL,
    photoURL: DEMO_USER_PHOTO,
  } as unknown as User;

  currentUser = demoUser;
  setAssistantOwner(demoUser.uid, { adoptUnowned: false });

  // Keep edits made in the preview deployment across rerenders and refreshes.
  // The demo user is isolated from real accounts by its dedicated uid.
  const demoStorageKey = "personal-wealth-os-state-demo-user";
  state = fresh ? emptyState() : localStorage.getItem(demoStorageKey) ? loadState(demoUser.uid) : demoStateFor(new Date());

  quizAllowed = true;
  renderSignedIn(demoUser);
} else {
  // Production path: real Firebase auth. Firebase takes a moment to confirm
  // the session, so someone who was signed in last time keeps the skeleton
  // from index.html until it does, instead of seeing the login page flash.
  if (wasSignedIn()) preloadFirestore();
  else renderLogin();
  onAuth((user) => {
    void handleAuth(user).catch((error: unknown) => {
      console.error("[Auth] Failed to initialize signed-in session:", error);
      if (!user) renderLogin();
    });
  });

  handleRedirectResult()
    .then((redirectUser) => {
      if (redirectUser) {
        console.log("[Auth] Sign-in successful via redirect:", redirectUser.email);
      }
    })
    .catch((error: unknown) => {
      console.error("[Auth] Redirect sign-in check failed:", error);
    });
}
