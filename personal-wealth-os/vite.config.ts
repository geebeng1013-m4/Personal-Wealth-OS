import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

/**
 * Serve the /api routes during `vite dev`.
 *
 * In production Vercel runs everything under api/ as serverless functions, but
 * the Vite dev server knows nothing about them, so /api/quote would 404 locally
 * and the portfolio would look permanently unpriced while developing. This
 * mounts the same handler on the dev server so local behaviour matches
 * deployed behaviour. Dev only — it is not part of the production build.
 */
function devApiRoutes(): Plugin {
  return {
    name: "dev-api-routes",
    apply: "serve",
    configureServer(server) {
      const mount = (route: string, module: string) =>
        server.middlewares.use(route, (request, response) => {
        void (async () => {
          try {
            const { default: handler } = await server.ssrLoadModule(module);
            const url = new URL(request.url ?? "/", "http://localhost");
            const query = Object.fromEntries(url.searchParams.entries());

            // Minimal VercelResponse shim: only what the handler actually uses.
            const shim = {
              status(code: number) { response.statusCode = code; return shim; },
              json(body: unknown) {
                response.setHeader("content-type", "application/json");
                response.end(JSON.stringify(body));
                return shim;
              },
              send(body: string) { response.end(body); return shim; },
              setHeader(key: string, value: string) { response.setHeader(key, value); },
            };
            // Headers are forwarded so the origin guard behaves the same here
            // as it does deployed — the whole point of this shim.
            await handler({ method: request.method, query, headers: request.headers }, shim);
          } catch (error) {
            response.statusCode = 500;
            response.setHeader("content-type", "application/json");
            response.end(JSON.stringify({ error: String(error) }));
          }
        })();
      });

      mount("/api/quote", "/api/quote.ts");
      mount("/api/market", "/api/market.ts");
    },
  };
}

/**
 * Stop the first screen swapping typefaces, now that nothing covers it.
 *
 * The launch screen used to wait for document.fonts.ready before it faded, so
 * the swap happened behind it. With the launch screen gone (#133) it became
 * visible: measured at 390x844, a warm start showed the fallback for ~104ms on
 * a good connection and ~499ms on a throttled one before Inter arrived. A cold
 * start does not swap at all — everything else is slower than the fonts.
 *
 * Two halves, and both are needed. `optional` is the guarantee: the browser
 * gives the font a short window and, if it misses, uses the fallback for that
 * whole page load rather than swapping mid-read. Preloading is what keeps that
 * window winnable, so "no swap" does not turn into "system font every time".
 *
 * Only the latin subsets, and not Lato: it dresses one line on the Overview,
 * its stack already falls through to Inter, and 23 KB is a poor trade for it.
 */
function fontsWithoutSwap(): Plugin {
  const PRELOAD = /(inter-latin-wght-normal|geist-mono-latin-[456]00-normal)-[^.]+\.woff2$/;
  return {
    name: "fonts-without-swap",
    apply: "build",
    // `pre`, so `transform` sees the raw CSS: by the time Vite's own CSS
    // plugin has run, the module's code is an empty string and the styles
    // live in the bundle. transformIndexHtml below asks for `post` on its
    // own, since it needs the finished bundle's file names.
    enforce: "pre",
    // In `transform`, not `generateBundle`: Vite hashes an asset's content
    // before generateBundle can touch it, so rewriting there changed the CSS
    // while leaving it at the same /assets/index-<hash>.css. Those URLs are
    // served `max-age=31536000, immutable`, so every browser and service
    // worker that already held the file would have gone on serving the old
    // one for a year and never seen the change.
    transform(code, id) {
      if (!id.includes("@fontsource") || !/\.css(\?|$)/.test(id)) return null;
      if (!code.includes("font-display")) return null;
      return { code: code.replace(/font-display:\s*swap/g, "font-display: optional"), map: null };
    },
    transformIndexHtml: {
      order: "post",
      // The bundle is read here rather than remembered from generateBundle:
      // the HTML is transformed first, so a list built there is still empty.
      handler(_html, ctx) {
        return Object.keys(ctx.bundle ?? {})
          .filter((file) => PRELOAD.test(file))
          .sort()
          .map((file) => ({
            tag: "link",
            attrs: { rel: "preload", as: "font", type: "font/woff2", href: `/${file}`, crossorigin: "" },
            injectTo: "head" as const,
          }));
      },
    },
  };
}

export default defineConfig({
  root: resolve(__dirname),
  plugins: [react(), devApiRoutes(), fontsWithoutSwap()],
  build: {
    rollupOptions: {
      output: {
        // Firebase's core rarely changes between our releases. In its own file
        // it keeps its year-long cache when only our code changes. Firestore is
        // deliberately not listed: it loads on demand (see src/firebase.ts).
        manualChunks(id) {
          if (/node_modules\/@firebase\/(app|auth|component|logger|util)\//.test(id)) return "firebase-core";
          return undefined;
        },
      },
    },
  },
});
