import "./styles.css";
import type { WealthState } from "./models";
import { loadState, saveState, loadStateFromCloud, syncLocalToCloud, emptyState } from "./state";
import { renderApp, quickViewTemplate } from "./ui";
import { onAuth, signInWithGoogle, handleRedirectResult, logOut } from "./firebase";
import type { User } from "firebase/auth";

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
  overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:9999;display:flex;align-items:center;justify-content:center;padding:24px;";
  overlay.innerHTML = `
    <div style="background:var(--surface-solid);border-radius:16px;padding:24px;max-width:320px;text-align:center;">
      <h3 style="margin:0 0 16px;font-size:18px;">Install Wealth OS</h3>
      <div style="text-align:left;font-size:14px;line-height:1.8;color:var(--ink-2);">
        <p>1. Tap the <strong>Share</strong> button <span style="font-size:18px;">⬆️</span> at the bottom of Safari</p>
        <p>2. Scroll down and tap <strong>"Add to Home Screen"</strong></p>
        <p>3. Tap <strong>"Add"</strong> in the top right</p>
      </div>
      <button id="closeInstallGuide" style="margin-top:16px;padding:10px 24px;border-radius:8px;border:1px solid var(--line);background:transparent;color:var(--ink);font-size:14px;cursor:pointer;">Got it</button>
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
  if (t === "light") return "light";
  return "dark";
}

function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("pwo-theme", theme);
}

// Initialize theme
applyTheme(getStoredTheme());

let state: WealthState = loadState(); // Initial load without UID (will be replaced on auth)
let currentPage = window.location.pathname === "/quick" ? "quick" : "dashboard";
let currentUser: User | null = null;
let cloudSyncUnsub: (() => void) | null = null;

// Expose theme toggle and page nav globally
(window as unknown as Record<string, unknown>).__pwo = {
  toggleTheme: () => {
    const current = getStoredTheme();
    applyTheme(current === "dark" ? "light" : "dark");
  },
  navigate: (page: string) => {
    currentPage = page;
    renderApp(root!, state, setState, page, navigate, currentUser ?? undefined, handleLogout);
  },
};

function setState(next: WealthState): void {
  state = next;
  // Only persist if a user is logged in (prevent saving to global key)
  const user = currentUser;
  if (user) {
    saveState(next, user.uid);
  }
}

function navigate(page: string): void {
  currentPage = page;
  renderApp(root!, state, setState, page, navigate, currentUser ?? undefined, handleLogout);
}

async function handleLogout(): Promise<void> {
  if (cloudSyncUnsub) { cloudSyncUnsub(); cloudSyncUnsub = null; }
  await logOut();
}

function renderLogin(): void {
  root!.className = "login-shell";
  root!.innerHTML = `
    <div class="login-container">
      <div class="login-card">
        <div class="login-brand">
          <div class="brand-mark-lg">PW</div>
          <h1>Personal Wealth OS</h1>
          <p>投资纪律 · 现金流 · 目标系统</p>
        </div>
        <div class="login-body">
          <p class="login-desc">登录后数据将自动同步到云端，多设备共享。</p>
          <button class="google-signin-btn" id="googleSignIn" type="button">
            <svg viewBox="0 0 24 24" width="20" height="20"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
            <span>使用 Google 账号登录</span>
          </button>
        </div>
      </div>
    </div>
  `;

  root!.querySelector<HTMLButtonElement>("#googleSignIn")?.addEventListener("click", async () => {
    try {
      const user = await signInWithGoogle();
      if (user) {
        console.log("[Auth] Sign-in successful via popup:", user.email);
      } else {
        console.log("[Auth] Redirecting to Google sign-in...");
      }
    } catch (err) {
      console.error("Sign-in failed:", err);
      alert("登录失败，请重试。");
    }
  });
}

async function handleAuth(user: User | null): Promise<void> {
  if (user) {
    currentUser = user;
    console.log(`[Auth] User signed in: ${user.uid} (${user.email})`);

    // Unsubscribe from previous cloud sync if any
    if (cloudSyncUnsub) { cloudSyncUnsub(); cloudSyncUnsub = null; }

    // Load user-specific local state (no fallback to global key)
    state = loadState(user.uid);

    // Try cloud state
    let hasCloudData = false;
    try {
      const cloudState = await loadStateFromCloud();
      if (cloudState) {
        state = cloudState;
        hasCloudData = true;
      }
    } catch (err) {
      console.error("[Auth] Cloud load failed, using local state:", err);
    }

    // Only push to cloud if user already has local data (sync up)
    // For brand new users with no cloud and no local data, push fresh default
    if (!hasCloudData) {
      const userStorageKey = `personal-wealth-os-state-${user.uid}`;
      const hasLocalData = localStorage.getItem(userStorageKey) !== null;
      if (hasLocalData) {
        // User has local data from before, sync it up
        await syncLocalToCloud(state);
      } else {
        // Brand new user — push fresh empty state to cloud
        state = emptyState();
        await syncLocalToCloud(state);
      }
    }

    // Save to user-specific localStorage
    saveState(state, user.uid);
    renderApp(root!, state, setState, currentPage, navigate, user, handleLogout);
  } else {
    currentUser = null;
    // Clear in-memory state to prevent leaking to next user
    state = emptyState();
    if (cloudSyncUnsub) { cloudSyncUnsub(); cloudSyncUnsub = null; }
    renderLogin();
  }
}

// Check for redirect result first, then start auth listener
handleRedirectResult().then((redirectUser) => {
  if (redirectUser) {
    console.log("[Auth] Sign-in successful via redirect:", redirectUser.email);
  }
  // Start auth listener (will fire with current user state)
  onAuth(handleAuth);
});
