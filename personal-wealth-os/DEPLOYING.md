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

`.github/workflows/ci.yml` runs the three checks below on every push to `main`
and on every pull request that touches `personal-wealth-os/`. It installs with
`npm ci`, so a lockfile that has drifted from `package.json` fails the run
rather than being papered over.

Locally, the same three:

```sh
npm run typecheck
npm test          # 657 unit tests
npm run build
```

Install with **npm**, not pnpm. The repository root carries a `pnpm-lock.yaml`
for the other projects in it, but this app is a standalone npm project — that is
what `vercel.json` runs and what CI runs. Mixing the two managers in this
directory is what left the dependency tree half-installed before.

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

## The demo site (`demo.wealthup.cc`)

The login page links to **https://demo.wealthup.cc** ("See a demo with sample
data"). That is a second Vercel project built from the same repository with
`VITE_DEMO_MODE=true`, so the production project and its data are never
involved.

What the demo shows:

- **Daniel Lim**, a fictional advisor's client (`src/demoDaniel.ts`), to every
  visitor.
- Alex, the original student fixture, only at `/?persona=alex`.
- `/?fresh` starts an empty account, to walk the new-user Q&A.
- A "Demo · sample data" banner with **Reset demo** on every page. Edits live
  only in that visitor's browser. The AI assistant is not shown.

One-time setup, in the Vercel dashboard:

1. **Add New → Project**, import the same GitHub repository.
2. **Root Directory**: `personal-wealth-os`. Name it e.g. `wealthup-demo`.
   Build settings come from `vercel.json`; leave them.
3. **Environment Variables**: `VITE_DEMO_MODE` = `true`, for Production and
   Preview. Only on this project — never on the production one.
4. **Deploy**, then **Settings → Domains** → add `demo.wealthup.cc` and create
   the DNS record Vercel shows.

A shared link previews differently on each site: `vite.config.ts`
(`sharePreview`) writes the demo's own title and description when
`VITE_DEMO_MODE=true`. Both use `public/og-image.jpg`; its source and how to
regenerate it are in `scripts/og-image/`. WhatsApp caches a link's preview, so
a changed image may take a while to show on a link already shared.

The demo never signs in, so it needs no Firebase authorized domain. Market
prices come from its own `/api` routes (same origin), which the origin guard
already allows.
