import { initializeApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  onAuthStateChanged,
  browserLocalPersistence,
  setPersistence,
  type User,
} from "firebase/auth";
import type { Unsubscribe } from "firebase/firestore";
import type { WealthState } from "./models";
import type { CloudSnapshot } from "./firestore";

export type { CloudSnapshot };

// Firebase web config isn't a secret (it's shipped to every browser and scoped by
// Firestore rules + authorized domains), but it's read from env vars so each
// environment (dev / preview / prod) can point at its own Firebase project.
// Falls back to the shared personal-wealth-os project if unset.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyBjw4mnFHV-43uJ6wE7pTBCDDN_i1p5kMw",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "personal-wealth-os-1deac.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "personal-wealth-os-1deac",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "personal-wealth-os-1deac.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "54126993111",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:54126993111:web:590ef8fd71a903c2b79a92",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

// Set persistence to local (survives browser restart)
setPersistence(auth, browserLocalPersistence);

// --- Auth ---

export async function signInWithGoogle(): Promise<User | null> {
  try {
    const result = await signInWithPopup(auth, provider);
    return result.user;
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    console.warn("[Auth] Popup failed:", code, "- trying redirect");
    // If popup was blocked or closed, fall back to redirect
    if (code === "auth/popup-blocked" || code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
      await signInWithRedirect(auth, provider);
      return null; // will be handled by getRedirectResult
    }
    throw err;
  }
}

export async function handleRedirectResult(): Promise<User | null> {
  try {
    const result = await getRedirectResult(auth);
    return result?.user ?? null;
  } catch (err) {
    console.error("[Auth] Redirect result error:", err);
    return null;
  }
}

export function logOut(): Promise<void> {
  return signOut(auth);
}

export function onAuth(callback: (user: User | null) => void): Unsubscribe {
  return onAuthStateChanged(auth, callback);
}

export function currentUser(): User | null {
  return auth.currentUser;
}

// --- Firestore ---
//
// Firestore is over half of what the app would otherwise download before its
// first screen, yet nothing needs it until after that screen: signed-in users
// see their local copy first and the cloud read follows. So it lives in
// ./firestore and loads on first use. Every call here was already async, so
// callers only wait for the download once.

let firestoreModule: Promise<typeof import("./firestore")> | null = null;

function firestore(): Promise<typeof import("./firestore")> {
  firestoreModule ??= import("./firestore");
  return firestoreModule;
}

/** Start downloading Firestore now, so it is ready by the time sync needs it. */
export function preloadFirestore(): void {
  void firestore().catch(() => {
    // A failed download is retried by the next real call.
    firestoreModule = null;
  });
}

export async function loadFromFirestore(uid: string): Promise<WealthState | null> {
  return (await firestore()).loadFromFirestore(uid);
}

export async function loadAssistantHistory(uid: string): Promise<unknown> {
  return (await firestore()).loadAssistantHistory(uid);
}

export async function saveAssistantHistory(uid: string, history: object): Promise<void> {
  return (await firestore()).saveAssistantHistory(uid, history);
}

export async function saveToFirestore(uid: string, state: WealthState): Promise<void> {
  return (await firestore()).saveToFirestore(uid, state);
}

/**
 * Subscribe to the user's cloud document (see ./firestore). Returns at once;
 * the listener attaches when Firestore has loaded, unless unsubscribed first.
 */
export function subscribeToFirestore(
  uid: string,
  callback: (snapshot: CloudSnapshot) => void
): Unsubscribe {
  let unsubscribe: Unsubscribe | null = null;
  let cancelled = false;
  firestore()
    .then((module) => {
      if (!cancelled) unsubscribe = module.subscribeToFirestore(uid, callback);
    })
    .catch((error: unknown) => {
      firestoreModule = null;
      console.error("[Firestore] Could not load; live sync is off until the next sign-in:", error);
    });
  return () => {
    cancelled = true;
    unsubscribe?.();
  };
}
