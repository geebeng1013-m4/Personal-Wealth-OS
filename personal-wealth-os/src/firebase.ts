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
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  onSnapshot,
  type Unsubscribe,
} from "firebase/firestore";
import type { WealthState } from "./models";

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
const db = getFirestore(app);
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

function userDocRef(uid: string) {
  return doc(db, "users", uid, "wealth", "state");
}

export async function loadFromFirestore(uid: string): Promise<WealthState | null> {
  const snap = await getDoc(userDocRef(uid));
  if (!snap.exists()) {
    if (import.meta.env.DEV) console.log("[Firestore] No data found for user");
    return null;
  }
  if (import.meta.env.DEV) console.log("[Firestore] Loaded data for user");
  return snap.data() as WealthState;
}

export function saveToFirestore(uid: string, state: WealthState): Promise<void> {
  return setDoc(userDocRef(uid), { ...state, _syncedAt: Date.now() }, { merge: true });
}

export function subscribeToFirestore(
  uid: string,
  callback: (state: WealthState) => void
): Unsubscribe {
  return onSnapshot(userDocRef(uid), (snap) => {
    if (snap.exists()) {
      callback(snap.data() as WealthState);
    }
  });
}