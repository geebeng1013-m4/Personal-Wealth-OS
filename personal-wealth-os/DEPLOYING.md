# Deploying

The app deploys to **Vercel**. Firebase provides Auth and Firestore only — not
hosting.

That split is the reason `api/` works at all: Vercel serves everything under
`api/` as serverless functions, and those routes are the only path to market
data (the browser cannot reach the upstream directly, and the anonymous CORS
proxies the client once fell back on have all stopped answering). Firebase
Hosting rewrites every path to `/index.html`, so serving the app from there
would return HTML for `/api/quote` and leave every holding permanently
unpriced.

## The app

Vercel builds from the repository. `vercel.json` pins the parts that matter:

| Setting | Value |
| --- | --- |
| Install | `npm ci` |
| Build | `npm run build` (runs `typecheck` first) |
| Output | `dist` |
| Rewrites | everything except `/api/*` → `/index.html` |

`package.json` requires Node 24.x.

Before pushing a deploy, the same three checks CI-equivalent work relies on:

```sh
npm run typecheck
npm test          # 654 unit tests
npm run build
```

## Firestore security rules

Rules are **not** deployed by Vercel. They ship through the Firebase CLI:

```sh
firebase deploy --only firestore:rules
```

`firebase.json` exists solely to point that command at `firestore.rules`, and
`.firebaserc` supplies the project id (`personal-wealth-os-1deac`). Neither file
configures hosting any more.

Re-run this whenever `firestore.rules` changes — the rules are the only thing
keeping one user's data out of another's, and a Vercel deploy will not carry
them.

## Custom domain

`wealthup.cc` is served by Vercel (domain settings live in the Vercel project).

One Firebase-side step is easy to miss and breaks sign-in when skipped: the
domain must also be listed under **Firebase Auth → Settings → Authorized
domains**. Google sign-in fails on any origin not in that list.

<https://console.firebase.google.com/project/personal-wealth-os-1deac/authentication/settings>

## Environment

`VITE_DEMO_MODE=true` builds the reviewable demo (`npm run build:demo`): a mock
user, fixture data, and no real Firestore writes. Never set it on the
production deploy.
