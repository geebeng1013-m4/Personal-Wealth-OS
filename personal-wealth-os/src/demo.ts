/**
 * Demo / Design Review mode detection.
 *
 * When VITE_DEMO_MODE=true is set at build time (e.g. via Vercel environment
 * variables for the preview deployment), the application skips Firebase auth,
 * loads static demo data, and disables all writes to Firestore / localStorage.
 *
 * Production builds leave this variable unset so the flag is always false.
 */

export const DEMO_MODE: boolean = import.meta.env.VITE_DEMO_MODE === "true";

export function isDemoMode(): boolean {
  return DEMO_MODE;
}