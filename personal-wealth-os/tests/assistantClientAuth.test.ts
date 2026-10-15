import assert from "node:assert/strict";
import { test } from "./testHarness";
import { askAssistant, setAssistantTokenProvider, type AssistantTokenProvider } from "../src/components/assistant/assistantClient";

const request = { messages: [{ role: "user" as const, content: "How do I record income?" }], mode: "help" as const, context: "" };

async function withSession(provider: AssistantTokenProvider | null, fetcher: typeof fetch, check: () => Promise<void>): Promise<void> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetcher;
  setAssistantTokenProvider(provider);
  try { await check(); } finally {
    setAssistantTokenProvider(null);
    globalThis.fetch = originalFetch;
  }
}

test("assistant auth: signed-out requests never reach the server", async () => {
  await withSession(null, async () => { throw new Error("Unexpected request"); }, async () => {
    assert.match((await askAssistant(request) as { error: string }).error, /Sign in/);
  });
});

test("assistant auth: token failure reports a connection problem without an unauthenticated request", async () => {
  await withSession(async () => { throw new Error("offline"); }, async () => { throw new Error("Unexpected request"); }, async () => {
    const result = await askAssistant(request);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /connection/);
      assert.doesNotMatch(result.error, /Sign in/);
    }
  });
});

test("assistant auth: missing and empty tokens never send a request", async () => {
  for (const token of [null, "", "  "]) {
    let calls = 0;
    await withSession(async () => token, async () => { calls++; return Response.json({ reply: "unexpected" }); }, async () => {
      assert.equal((await askAssistant(request)).ok, false);
      assert.equal(calls, 0);
    });
  }
});

test("assistant auth: normal request carries its token without a forced refresh", async () => {
  const refreshes: (boolean | undefined)[] = [];
  await withSession(async (refresh) => { refreshes.push(refresh); return "valid-token"; }, async (_url, init) => {
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer valid-token");
    return Response.json({ reply: "Success" });
  }, async () => {
    assert.deepEqual(await askAssistant(request), { ok: true, reply: "Success" });
    assert.deepEqual(refreshes, [false]);
  });
});

test("assistant auth: a 401 refreshes once and resends with the new token", async () => {
  const refreshes: (boolean | undefined)[] = [];
  let calls = 0;
  await withSession(async (refresh) => { refreshes.push(refresh); return refresh ? "fresh-token" : "stale-token"; }, async (_url, init) => {
    calls++;
    assert.equal(new Headers(init?.headers).get("Authorization"), calls === 1 ? "Bearer stale-token" : "Bearer fresh-token");
    return calls === 1 ? Response.json({ error: "Sign in" }, { status: 401 }) : Response.json({ reply: "Recovered" });
  }, async () => {
    assert.deepEqual(await askAssistant(request), { ok: true, reply: "Recovered" });
    assert.equal(calls, 2);
    assert.deepEqual(refreshes, [false, true]);
  });
});

test("assistant auth: a second 401 asks for sign-in without further retries", async () => {
  let calls = 0;
  await withSession(async () => "token", async () => { calls++; return Response.json({}, { status: 401 }); }, async () => {
    const result = await askAssistant(request);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /Sign in again/);
    assert.equal(calls, 2);
  });
});

test("assistant auth: offline forced refresh does not resend without credentials", async () => {
  let calls = 0;
  await withSession(async (refresh) => {
    if (refresh) throw new Error("offline");
    return "stale-token";
  }, async () => { calls++; return Response.json({}, { status: 401 }); }, async () => {
    const result = await askAssistant(request);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /connection/);
      assert.doesNotMatch(result.error, /Sign in/);
    }
    assert.equal(calls, 1);
  });
});

test("assistant auth: quota and server failures are never retried", async () => {
  for (const status of [403, 429, 503]) {
    let calls = 0;
    await withSession(async () => "token", async () => { calls++; return Response.json({}, { status }); }, async () => {
      assert.equal((await askAssistant(request)).ok, false);
      assert.equal(calls, 1);
    });
  }
});

test("assistant auth: sign-out cancels pending token acquisition without waiting for Firebase", async () => {
  let calls = 0;
  await withSession(() => new Promise(() => {}), async () => { calls++; return Response.json({}); }, async () => {
    const pending = askAssistant(request);
    setAssistantTokenProvider(null);
    assert.deepEqual(await pending, { ok: false, error: "Cancelled." });
    assert.equal(calls, 0);
  });
});

test("assistant auth: switching account during a 401 prevents retrying the old request", async () => {
  let calls = 0;
  await withSession(async () => "old-token", async (_url, init) => {
    calls++;
    setAssistantTokenProvider(async () => "new-token");
    assert.equal(init?.signal?.aborted, true);
    return Response.json({}, { status: 401 });
  }, async () => {
    assert.deepEqual(await askAssistant(request), { ok: false, error: "Cancelled." });
    assert.equal(calls, 1);
  });
});

test("assistant auth: caller cancellation also cancels pending token acquisition", async () => {
  await withSession(() => new Promise(() => {}), async () => { throw new Error("Unexpected request"); }, async () => {
    const controller = new AbortController();
    const pending = askAssistant(request, controller.signal);
    controller.abort();
    assert.deepEqual(await pending, { ok: false, error: "Cancelled." });
  });
});
