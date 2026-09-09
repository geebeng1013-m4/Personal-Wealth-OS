import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Capacitor wraps the built web app (dist/) in a native iOS/Android shell.
 *
 * The native projects (android/, ios/) are NOT in this repo — they are
 * generated with `npx cap add <platform>` on a machine that has Android Studio
 * / Xcode. See docs/app-packaging.md for the full walkthrough.
 *
 * webDir points at Vite's build output. Bundling the assets into the app (no
 * `server.url`) is deliberate: an app that loads its UI from a remote URL is
 * slower to start, breaks offline, and draws extra scrutiny in app review.
 */
const config: CapacitorConfig = {
  appId: "cc.wealthup.app",
  appName: "WealthUp",
  webDir: "dist",
  server: {
    androidScheme: "https",
  },
};

export default config;
