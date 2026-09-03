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

export default defineConfig({
  root: resolve(__dirname),
  plugins: [react(), devApiRoutes()],
});
