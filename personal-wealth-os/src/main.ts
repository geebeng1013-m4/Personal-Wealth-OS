import "./theme.css";
import "./components.css";
import "./shell.css";
import "./legacy-tail.css";
import type { WealthState } from "./models";
import { loadState, saveState, loadStateFromCloud, syncLocalToCloud, emptyState } from "./state";
import { renderApp } from "./ui";
import { onAuth, signInWithGoogle, handleRedirectResult, logOut } from "./firebase";
import { fetchUsdToMyr, pruneMarketCache } from "./market";
import type { User } from "firebase/auth";
import { isDemoMode } from "./demo";
import { demoStateFor, DEMO_USER_DISPLAY_NAME, DEMO_USER_EMAIL, DEMO_USER_PHOTO } from "./demoData";

// Drop stale cached ticker data from previous sessions so localStorage doesn't grow unbounded.
pruneMarketCache();

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
  overlay.style.cssText = "position:fixed;inset:0;background:var(--surface-overlay);z-index:9999;display:flex;align-items:center;justify-content:center;padding:24px;";
  overlay.innerHTML = `
    <div class="wu wu-card" style="max-width:320px;text-align:center;">
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

function getStoredTheme(): Theme {
  const t = localStorage.getItem("pwo-theme");
  if (t === "light" || t === "dark") return t;
  // First load: follow the OS. Once the user toggles, the stored value wins.
  try {
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
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
  "settings",
  "money-leaks",
]);

function pageFromLocation(): string {
  if (window.location.pathname === "/quick") return "quick";
  const hashPage = window.location.hash.slice(1);
  if (hashPage === "quick") return "quick";
  return appPages.has(hashPage) ? hashPage : "dashboard";
}

function rememberPage(page: string): void {
  if (page === "quick") return;
  const nextHash = `#${page}`;
  if (window.location.hash !== nextHash) {
    window.history.replaceState(null, "", nextHash);
  }
}

let currentPage = pageFromLocation();
let currentUser: User | null = null;
let cloudSyncUnsub: (() => void) | null = null;
let authRequestId = 0;

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
    saveState(next, user.uid, changeLabel);
  }
}

function navigate(page: string): void {
  currentPage = appPages.has(page) || page === "quick" ? page : "dashboard";
  rememberPage(currentPage);
  renderApp(root!, state, setState, currentPage, navigate, currentUser ?? undefined, handleLogout);
}

async function handleLogout(): Promise<void> {
  if (cloudSyncUnsub) { cloudSyncUnsub(); cloudSyncUnsub = null; }
  await logOut();
}

function renderLogin(): void {
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
          <p class="login-desc">Sign in to sync your data securely across devices.</p>
          <button class="google-signin-btn" id="googleSignIn" type="button">
            <svg viewBox="0 0 24 24" width="20" height="20"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
            <span>Sign in with Google</span>
          </button>
        </div>
      </div>
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

  if (user) {
    currentUser = user;
    console.log(`[Auth] User signed in: ${user.uid} (${user.email})`);

    // Unsubscribe from previous cloud sync if any
    if (cloudSyncUnsub) { cloudSyncUnsub(); cloudSyncUnsub = null; }

    const userStorageKey = `personal-wealth-os-state-${user.uid}`;
    const hasLocalData = localStorage.getItem(userStorageKey) !== null;

    // Show the user-specific local state immediately. Cloud access can be slow,
    // unavailable offline, or denied without preventing access to saved data.
    state = loadState(user.uid);
    renderApp(root!, state, setState, currentPage, navigate, user, handleLogout);

    // Warm the exchange rate cache early so the dashboard renders with current
    // rates — and hand it the user's own conversions, so a failed request falls
    // back on a rate they really got rather than on a hard-coded constant.
    void fetchUsdToMyr(state.trades, state.currencyExchanges).catch(() => {});

    try {
      const cloudState = await loadStateFromCloud();
      if (requestId !== authRequestId || currentUser?.uid !== user.uid) return;

      if (cloudState) {
        state = cloudState;
        renderApp(root!, state, setState, currentPage, navigate, user, handleLogout);
      } else if (hasLocalData) {
        // User has local data from before, sync it up
        await syncLocalToCloud(state);
      } else {
        // Brand new user — push fresh empty state to cloud
        state = emptyState();
        saveState(state, user.uid);
        await syncLocalToCloud(state);
        if (requestId !== authRequestId || currentUser?.uid !== user.uid) return;
        renderApp(root!, state, setState, currentPage, navigate, user, handleLogout);
      }
    } catch (err) {
      // A failed read is not the same as an empty cloud document. Keep the local
      // state and never overwrite cloud data when connectivity or permissions fail.
      console.error("[Auth] Cloud load failed, continuing with local state:", err);
    }

  } else {
    currentUser = null;
    // Clear in-memory state to prevent leaking to next user
    state = emptyState();
    if (cloudSyncUnsub) { cloudSyncUnsub(); cloudSyncUnsub = null; }
    renderLogin();
  }
}

// --- Demo mode: skip Firebase, load static demo data ---
if (isDemoMode()) {
  console.log("[Demo] Design Review mode — Firebase auth and writes are disabled.");
  // Create a minimal mock user so the UI renders normally without real auth.
  const demoUser = {
    uid: "demo-user",
    displayName: DEMO_USER_DISPLAY_NAME,
    email: DEMO_USER_EMAIL,
    photoURL: DEMO_USER_PHOTO,
  } as unknown as User;

  currentUser = demoUser;

  // Keep edits made in the preview deployment across rerenders and refreshes.
  // The demo user is isolated from real accounts by its dedicated uid.
  const demoStorageKey = "personal-wealth-os-state-demo-user";
  state = localStorage.getItem(demoStorageKey) ? loadState(demoUser.uid) : demoStateFor(new Date());

  renderApp(root!, state, setState, currentPage, navigate, demoUser, handleLogout);
} else {
  // Production path: real Firebase auth
  renderLogin();
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
