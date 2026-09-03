import assert from "node:assert/strict";
import { test } from "./testHarness";
import { isAllowedOrigin } from "../api/_originGuard";
import type { VercelRequest } from "@vercel/node";

/** Just enough of a VercelRequest for the guard, which only reads headers. */
function requestWithOrigin(origin?: string): VercelRequest {
  return { headers: origin === undefined ? {} : { origin } } as unknown as VercelRequest;
}

// --- the case that must never break: the app's own calls -------------------

test("originGuard: a same-origin request, which sends no Origin at all, is allowed", () => {
  // Browsers omit Origin on same-origin GETs. This is what every real call
  // from the app looks like, and rejecting it would break the product.
  assert.equal(isAllowedOrigin(requestWithOrigin()), true);
});

test("originGuard: an empty Origin header is treated as absent, not as hostile", () => {
  assert.equal(isAllowedOrigin(requestWithOrigin("")), true);
});

test("originGuard: a request with no headers object at all is allowed", () => {
  assert.equal(isAllowedOrigin({} as unknown as VercelRequest), true);
});

// --- the case this exists to stop ------------------------------------------

test("originGuard: a cross-site Origin is rejected", () => {
  assert.equal(isAllowedOrigin(requestWithOrigin("https://someone-elses-app.com")), false);
});

test("originGuard: a lookalike hostname is rejected", () => {
  // Suffix matching would wave these through; hostname equality does not.
  assert.equal(isAllowedOrigin(requestWithOrigin("https://wealthup.cc.evil.com")), false);
  assert.equal(isAllowedOrigin(requestWithOrigin("https://notwealthup.cc")), false);
});

test("originGuard: a fake vercel.app suffix on another domain is rejected", () => {
  assert.equal(isAllowedOrigin(requestWithOrigin("https://vercel.app.evil.com")), false);
});

test('originGuard: the literal Origin "null" is rejected', () => {
  // Sandboxed iframes and file:// documents send this. It is not a URL, and
  // it is not ours.
  assert.equal(isAllowedOrigin(requestWithOrigin("null")), false);
});

test("originGuard: a malformed Origin is rejected", () => {
  assert.equal(isAllowedOrigin(requestWithOrigin("not a url")), false);
});

// --- the origins that are ours --------------------------------------------

test("originGuard: the production domain is allowed, with and without www", () => {
  assert.equal(isAllowedOrigin(requestWithOrigin("https://wealthup.cc")), true);
  assert.equal(isAllowedOrigin(requestWithOrigin("https://www.wealthup.cc")), true);
});

test("originGuard: a Vercel preview deployment is allowed", () => {
  assert.equal(isAllowedOrigin(requestWithOrigin("https://personal-wealth-os-abc123.vercel.app")), true);
});

test("originGuard: local development is allowed on either loopback name", () => {
  assert.equal(isAllowedOrigin(requestWithOrigin("http://localhost:5173")), true);
  assert.equal(isAllowedOrigin(requestWithOrigin("http://127.0.0.1:5199")), true);
});

test("originGuard: matching ignores case and port", () => {
  assert.equal(isAllowedOrigin(requestWithOrigin("https://WealthUp.CC")), true);
  assert.equal(isAllowedOrigin(requestWithOrigin("https://wealthup.cc:443")), true);
});
