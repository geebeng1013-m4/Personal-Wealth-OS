// Everything that touches Firestore. Loaded on first use through ./firebase,
// which keeps this out of the bundle the first screen waits for.
import { getApp, type FirebaseApp } from "firebase/app";
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

// ./firebase has initialised the app before anything can import this module.
const db = createFirestore(getApp());

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
function createFirestore(firebaseApp: FirebaseApp): Firestore {
  try {
    return initializeFirestore(firebaseApp, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch (error) {
    console.warn("[Firestore] Offline persistence unavailable, falling back to memory-only:", error);
    return getFirestore(firebaseApp);
  }
}

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

/**
 * The assistant's history, beside the wealth document rather than inside it: a
 * conversation is not a financial fact, and keeping it out of WealthState
 * leaves the schema, migrations and snapshots untouched. The existing rule on
 * users/{uid}/** already limits it to its owner.
 */
function assistantHistoryRef(uid: string) {
  return doc(db, "users", uid, "assistant", "history");
}

export async function loadAssistantHistory(uid: string): Promise<unknown> {
  const snap = await getDoc(assistantHistoryRef(uid));
  return snap.exists() ? snap.data() : null;
}

export function saveAssistantHistory(uid: string, history: object): Promise<void> {
  return setDoc(assistantHistoryRef(uid), { ...history, _syncedAt: Date.now() });
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