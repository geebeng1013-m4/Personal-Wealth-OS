import "./styles.css";
import type { WealthState } from "./models";
import { loadState, saveState, loadStateFromCloud, syncLocalToCloud } from "./state";
import { renderApp } from "./ui";
import { onAuth, signInWithGoogle, handleRedirectResult, logOut } from "./firebase";
import type { User } from "firebase/auth";

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
let currentPage = "dashboard";
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
    renderApp(root!, state, setState, page, navigate);
  },
};

function setState(next: WealthState): void {
  state = next;
  // Save with user-specific key if logged in
  const user = currentUser;
  saveState(next, user?.uid);
}

function navigate(page: string): void {
  currentPage = page;
  renderApp(root!, state, setState, page, navigate);
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
    // Load user-specific local state first
    state = loadState(user.uid);
    // Then try cloud state
    try {
      const cloudState = await loadStateFromCloud();
      if (cloudState) {
        state = cloudState;
      } else {
        // Cloud returned null = document doesn't exist yet, push local state to cloud
        console.log(`[Auth] No cloud data for ${user.uid}, pushing local state`);
        await syncLocalToCloud(state);
      }
    } catch (err) {
      // Cloud load failed (e.g., permission error) - don't overwrite cloud, just use local
      console.error("[Auth] Cloud load failed, using local state:", err);
    }
    // Save to user-specific localStorage
    saveState(state, user.uid);
    renderApp(root!, state, setState, currentPage, navigate);
    addUserBadge(user);
  } else {
    currentUser = null;
    renderLogin();
  }
}

function addUserBadge(user: User): void {
  const topActions = root!.querySelector<HTMLElement>(".top-actions");
  if (!topActions) return;
  const existing = topActions.querySelector(".user-badge");
  if (existing) existing.remove();

  const badge = document.createElement("div");
  badge.className = "user-badge";
  badge.innerHTML = `
    <img src="${user.photoURL || ""}" alt="" class="user-avatar" referrerpolicy="no-referrer">
    <span class="user-name">${user.displayName || user.email || "User"}</span>
    <button class="secondary-button logout-btn" type="button">退出</button>
  `;
  topActions.prepend(badge);
  badge.querySelector(".logout-btn")?.addEventListener("click", async () => {
    if (cloudSyncUnsub) { cloudSyncUnsub(); cloudSyncUnsub = null; }
    await logOut();
  });
}

// Check for redirect result first, then start auth listener
handleRedirectResult().then((redirectUser) => {
  if (redirectUser) {
    console.log("[Auth] Sign-in successful via redirect:", redirectUser.email);
  }
  // Start auth listener (will fire with current user state)
  onAuth(handleAuth);
});
