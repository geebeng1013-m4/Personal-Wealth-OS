# Packaging WealthUp as a native app (Capacitor)

Capacitor wraps the built web app (`dist/`) in a thin native iOS/Android shell.
Same codebase, same UI. This document is the step-by-step for taking it from
"web only" to "installable from the App Store / Google Play".

---

## 0. What is already done (in the repo)

- `@capacitor/core`, `@capacitor/cli`, `@capacitor/app`, **`@capacitor/android`**
  are installed.
- `capacitor.config.ts` — `appId: cc.wealthup.app`, `appName: WealthUp`,
  `webDir: dist`, assets bundled (no remote `server.url`).
- **`android/`** — the native Android project, generated with
  `npx cap add android`. Committed. Its build output stays out via
  `android/.gitignore` + the root `.gitignore`.
- `npm run cap:sync` — builds the web app, then copies it into `android/` (and
  `ios/` once added) and updates plugins.

**Not** in the repo yet, and needs a **Mac**: the `ios/` project and anything
App Store. Also not done anywhere yet: an APK/AAB build, running on a device,
the Firebase-sign-in fix (§2a), icons/splash, deep links.

---

## 1. Prerequisites

| For | You need |
| --- | --- |
| Android | **Android Studio** (bundles the Android SDK + a JDK). Any OS. |
| iOS | A **Mac** with **Xcode**. No way around this. |
| Google Play | A **Google Play Console** account — US$25, one-time. |
| App Store | An **Apple Developer** account — US$99/year. |
| Both | Node 24 + this repo, `npm ci` run, `npm run build` green. |

You can do Android entirely on Windows. iOS needs the Mac.

---

## 2. Android — run it

The `android/` project is already in the repo (added with
`npm i @capacitor/android` then `npx cap add android`). On a machine with
Android Studio + the SDK installed:

```sh
cd personal-wealth-os
npm ci
npm run cap:sync         # build the web app + copy it into android/
npx cap open android     # opens android/ in Android Studio
```

In Android Studio: let it finish the Gradle sync (first time pulls the Android
Gradle Plugin + dependencies — a few minutes), then **Run ▶** with an emulator
(Device Manager → Create Device) or a USB-connected phone (Developer Options →
USB debugging). The app should launch and show the dashboard.

If Android Studio installed to a non-default path (e.g. `Android Studio1`
because a leftover folder held the name), `npx cap open android` may not find
it — just open `personal-wealth-os/android` from Android Studio's
**File → Open** instead.

### 2a. The Firebase sign-in fix — do this before you rely on login

`firebase.ts` uses `signInWithPopup` (falling back to `signInWithRedirect`).
**Neither works inside a Capacitor WebView** — there is no popup, and the
redirect flow round-trips through a Firebase-hosted page that the WebView
handles badly. Symptom: tapping "Sign in with Google" does nothing, or spins.

Fix: use native Google Sign-In on device, keep the web flow in a browser.

```sh
npm i @capacitor-firebase/authentication
npm run cap:sync
```

Then in `src/firebase.ts`, branch `signInWithGoogle`:

```ts
import { Capacitor } from "@capacitor/core";
import { FirebaseAuthentication } from "@capacitor-firebase/authentication";
import { GoogleAuthProvider, signInWithCredential } from "firebase/auth";

export async function signInWithGoogle(): Promise<User | null> {
  if (Capacitor.isNativePlatform()) {
    const result = await FirebaseAuthentication.signInWithGoogle();
    const credential = GoogleAuthProvider.credential(result.credential?.idToken);
    const { user } = await signInWithCredential(auth, credential);
    return user;
  }
  // ...existing popup / redirect flow for the browser...
}
```

Native Google Sign-In also needs OAuth configured in Firebase:

- **Android**: get the signing certificate SHA-1 **and** SHA-256
  (`cd android && ./gradlew signingReport`, or from Play Console → App integrity
  once you upload), and add both in Firebase Console → Project settings → your
  Android app. Re-download `google-services.json` and put it at
  `android/app/google-services.json`.
- The `@capacitor-firebase/authentication` plugin's README has the exact
  `google-services.json` / `Info.plist` steps — follow it, it changes between
  versions.

### 2b. Build a release AAB

```sh
cd android
./gradlew bundleRelease      # or use Android Studio: Build → Generate Signed Bundle
```

You need an **upload keystore** (Android Studio walks you through creating one;
keep it and its passwords safe forever — losing it means you cannot update the
app). The output is `android/app/build/outputs/bundle/release/app-release.aab`.

Upload that to **Play Console → your app → Testing → Internal testing** first,
add yourself as a tester, install from the opt-in link on a real phone. Only
promote to Production once that works.

---

## 3. iOS — add the platform (Mac only)

```sh
cd personal-wealth-os
npm ci && npm run build
npx cap add ios          # creates the ios/ folder (commit it)
npm run cap:sync
npx cap open ios         # opens ios/App/App.xcworkspace in Xcode
```

In Xcode:

- Select the **App** target → **Signing & Capabilities** → set your Team
  (your Apple Developer account) and a unique Bundle Identifier
  (`cc.wealthup.app`).
- **Run ▶** on a simulator or a connected iPhone.

Apply the same Firebase sign-in fix as 2a. For iOS the plugin also wants the
**reversed client ID** added as a URL scheme in `Info.plist` and
`GoogleService-Info.plist` at `ios/App/App/GoogleService-Info.plist` — again,
the plugin README is authoritative.

### 3a. Ship to the App Store

- Xcode → **Product → Archive** → **Distribute App → App Store Connect**.
- In **App Store Connect** (appstoreconnect.apple.com): create the app record,
  fill in the privacy questions (see §6), screenshots, and submit for review.
- Use **TestFlight** (built into App Store Connect) for internal testing before
  a public release.

**Apple requirement:** if the app offers Google sign-in, it must also offer
**Sign in with Apple**. Add `signInWithApple` (Firebase supports the provider;
`@capacitor-firebase/authentication` has `signInWithApple`) before submitting,
or review will reject it.

---

## 4. App icon and splash screen

One source image → all the sizes:

```sh
npm i -D @capacitor/assets
# put a 1024x1024 PNG at resources/icon.png and a 2732x2732 at resources/splash.png
npx capacitor-assets generate
```

It writes the icon/splash sets into `android/` and `ios/`. Re-run after changing
the source images. Commit the generated files.

---

## 5. Deep links (wealthup.cc opens the app)

So a `https://wealthup.cc/...` link opens the installed app instead of the
browser.

1. **Serve the association files from Vercel** — add to `public/.well-known/`:
   - `apple-app-site-association` (no extension, served as `application/json`):
     ```json
     { "applinks": { "apps": [], "details": [
       { "appID": "TEAMID.cc.wealthup.app", "paths": ["*"] } ] } }
     ```
     (`TEAMID` is your Apple Developer Team ID.)
   - `assetlinks.json`:
     ```json
     [{ "relation": ["delegate_permission/common.handle_all_urls"],
        "target": { "namespace": "android_app", "package_name": "cc.wealthup.app",
          "sha256_cert_fingerprints": ["<your release SHA-256>"] } }]
     ```
   Make sure `vercel.json` does not rewrite `/.well-known/*` to `index.html`.

2. **Android**: in `android/app/src/main/AndroidManifest.xml`, add an
   `intent-filter` with `android:autoVerify="true"` for `https` + `wealthup.cc`.
   `npx cap add` gives you a starting manifest; Capacitor's deep-links guide has
   the exact block.

3. **iOS**: Xcode → Signing & Capabilities → **+ Capability → Associated
   Domains** → add `applinks:wealthup.cc`.

4. **In the app**, handle the opened URL:
   ```ts
   import { App } from "@capacitor/app";
   App.addListener("appUrlOpen", ({ url }) => {
     const path = new URL(url).pathname + new URL(url).hash;
     // route to `path` with the app's existing hash router
   });
   ```

---

## 6. Store listing checklist

- **Privacy questions** (both stores ask): the app collects the user's own
  financial data, stored in Firebase (Auth + Firestore). It does **not** sell
  data or use third-party ad/analytics SDKs. Have a privacy policy URL ready
  (see `COMMERCIALIZATION_PLAN.md` phase 0 — this must exist before you ship a
  paid or public build).
- **Financial-app framing**: the listing and the in-app copy must not present
  the Advisor output as guaranteed returns or personalised investment advice.
  The standing "not financial advice" disclaimer (already in the app) covers
  the in-app side; keep the store description consistent.
- Screenshots for each required device size, an app description, keywords, a
  support URL, an age rating.

---

## 7. Ongoing loop (after the first release)

Every time the web app changes and you want a new app build:

```sh
npm run cap:sync        # rebuilds dist/ and copies it into android/ + ios/
```

then rebuild/re-archive from Android Studio / Xcode and upload. The web
deploy (`wealthup.cc` on Vercel) and the app builds are independent — a web
change is live immediately; an app change ships on the store's timeline.
