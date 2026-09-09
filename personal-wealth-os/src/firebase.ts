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
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  doc,
  getDoc,
  setDoc,
  onSnapshot,
  type Unsubscribe,
  type Firestore,
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
const db = createFirestore(app);
const provider = new GoogleAuthProvider();

/**
 * Firestore with an IndexedDB-backed local cache, so a write made offline is
 * queued on disk and replayed automatically once the connection returns,
 * instead of failing outright.
 *
 * Before this, saveState's only response to a failed Firestore write was to
 * log it and fire a "sync failed" event — the edit itself had nowhere to go
 * but the browser tab's memory. Close that tab before the connection came
 * back and the edit was gone from the cloud for good, indistinguishable from
 * loadStateFromCloud's own "local is newer" case except that there was no
 * local copy left to be newer than.
 *
 * persistentMultipleTabManager coordinates the cache across tabs of the same
 * origin so two open tabs don't fight over one IndexedDB connection — the
 * default single-tab manager would make the second tab fall back to memory
 * only, silently losing the offline queue it thinks it has.
 *
 * Falls back to plain in-memory Firestore if IndexedDB is unavailable —
 * private browsing in some browsers, or a user policy that blocks site data.
 * Sync still works there; only the offline queue is lost, which is exactly
 * the behaviour this app already had everywhere until now.
 */
function createFirestore(firebaseApp: ReturnType<typeof initializeApp>): Firestore {
  try {
    return initializeFirestore(firebaseApp, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch (error) {
    console.warn("[Firestore] Offline persistence unavailable, falling back to memory-only:", error);
    return getFirestore(firebaseApp);
  }
}

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

/**
 * One delivery of the user's cloud document, with the two metadata bits that
 * make an offline-safe sync decision possible.
 */
export interface CloudSnapshot {
  state: WealthState;
  /**
   * The snapshot came from the local cache, not a confirmed server read.
   * Every write produces one of these immediately (optimistic), followed by a
   * `fromCache: false` delivery once the server has it.
   */
  fromCache: boolean;
  /**
   * This client has local writes the server has not acknowledged yet. While
   * true, the local copy is ahead of the server regardless of any clock.
   */
  hasPendingWrites: boolean;
}

/**
 * Subscribe to the user's cloud document.
 *
 * `includeMetadataChanges` is what makes this useful for conflict handling: it
 * delivers the metadata-only transition when a write goes from pending to
 * server-confirmed, which is the moment a device can safely record a sync
 * point. Without it, `hasPendingWrites` clearing would be invisible.
 */
export function subscribeToFirestore(
  uid: string,
  callback: (snapshot: CloudSnapshot) => void
): Unsubscribe {
  return onSnapshot(
    userDocRef(uid),
    { includeMetadataChanges: true },
    (snap) => {
      if (!snap.exists()) return;
      callback({
        state: snap.data() as WealthState,
        fromCache: snap.metadata.fromCache,
        hasPendingWrites: snap.metadata.hasPendingWrites,
      });
    },
  );
}