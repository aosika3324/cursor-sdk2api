import { statSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { CursorAccountFileStore } from "../../src/account/file-store.js";
import { closeTestApp, startTestApp, type TestContext } from "../helpers/app.js";

let ctx: TestContext | undefined;
let restoreFetch: (() => void) | undefined;

afterEach(async () => {
  if (ctx) await closeTestApp(ctx);
  ctx = undefined;
  if (restoreFetch) restoreFetch();
  restoreFetch = undefined;
});

// A minimal browser session token: user_x::<header>.<payload>.<sig> with
// type=session, matching what onboarding validates before any network call.
function sessionToken(): string {
  const payload = Buffer.from(JSON.stringify({ sub: "u", type: "session" })).toString("base64url");
  return `user_x::h.${payload}.sig`;
}

// Stub globalThis.fetch so the onboard handler's dashboard calls are faked,
// while requests to the local test server (127.0.0.1) hit the real fetch.
function stubOnboardingFetch(): void {
  const real = globalThis.fetch;
  const stub = vi.fn(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("127.0.0.1") || url.includes("localhost")) {
      return real(input as never, init);
    }
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    if (url.endsWith("check-user-api-key-access")) return json({ hasAccess: true });
    if (url.endsWith("create-user-api-key")) return json({ apiKey: "crsr_minted_onboard" });
    throw new Error(`unexpected onboarding url ${url}`);
  });
  globalThis.fetch = stub as unknown as typeof globalThis.fetch;
  restoreFetch = () => {
    globalThis.fetch = real;
  };
}

test("accounts persist across gateway restarts with CPA-style private files", async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "cursor-sdk2api-persistent-"));
  ctx = await startTestApp({ config: { stateDir } });

  const created = await fetch(`${ctx.url}/v0/management/accounts`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ api_key: "fixture-account-key" }),
  });
  expect(created.status).toBe(201);
  const createdBody = (await created.json()) as { account: { id: string; key_hint: string } };
  expect(createdBody.account.key_hint).toBe("••••-key");
  expect(JSON.stringify(createdBody)).not.toContain("fixture-account-key");
  expect(statSync(join(stateDir, "auths")).mode & 0o777).toBe(0o700);
  expect(statSync(join(stateDir, "auths", `${createdBody.account.id}.json`)).mode & 0o777).toBe(0o600);

  await closeTestApp(ctx);
  ctx = await startTestApp({ config: { stateDir } });
  const restored = await fetch(`${ctx.url}/v0/management/accounts`);
  const restoredBody = (await restored.json()) as { accounts: Array<{ id: string; key_hint: string }> };
  expect(restoredBody.accounts).toEqual([
    expect.objectContaining({ id: createdBody.account.id, key_hint: createdBody.account.key_hint }),
  ]);
  expect(JSON.stringify(restoredBody)).not.toContain("fixture-account-key");

  const removed = await fetch(`${ctx.url}/v0/management/accounts?id=${encodeURIComponent(createdBody.account.id)}`, {
    method: "DELETE",
  });
  expect(removed.status).toBe(200);
  const empty = await fetch(`${ctx.url}/v0/management/accounts`);
  expect(await empty.json()).toMatchObject({ accounts: [] });
});

test("adding the same Cursor key is idempotent", async () => {
  ctx = await startTestApp();
  const add = () => fetch(`${ctx!.url}/v0/management/accounts`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ api_key: "same-key" }),
  });
  const first = (await (await add()).json()) as { account: { id: string } };
  const second = (await (await add()).json()) as { account: { id: string } };
  expect(second.account.id).toBe(first.account.id);
  const listed = await fetch(`${ctx.url}/v0/management/accounts`);
  const body = (await listed.json()) as { accounts: unknown[] };
  expect(body.accounts).toHaveLength(1);
});

test("account probe uses the stored Cursor key without returning it to the browser", async () => {
  ctx = await startTestApp({
    sdk: {
      modelsByApiKey: {
        "probe-secret-key": { ok: true, models: [{ id: "claude-sonnet-4-6", displayName: "Sonnet 4.6" }] },
      },
      accountsByApiKey: {
        "probe-secret-key": { ok: true, identity: { apiKeyName: "probe-account" } },
      },
    },
  });
  const created = await fetch(`${ctx.url}/v0/management/accounts`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ api_key: "probe-secret-key" }),
  });
  const { account } = (await created.json()) as { account: { id: string } };

  const response = await fetch(`${ctx.url}/v0/management/accounts/probe?id=${encodeURIComponent(account.id)}`);
  const text = await response.text();
  expect(response.status).toBe(200);
  expect(text).not.toContain("probe-secret-key");
  expect(JSON.parse(text)).toMatchObject({
    models: { data: [{ id: "claude-sonnet-4-6" }] },
    account: { identity: { api_key_name: "probe-account" } },
  });
  expect(ctx.sdk.listModelsApiKeys).toContain("probe-secret-key");
  expect(ctx.sdk.getAccountApiKeys).toContain("probe-secret-key");
});

test("account playground runs with the selected stored Cursor key", async () => {
  ctx = await startTestApp({
    sdk: { scripts: [[{ type: "text", chunks: ["managed console ok"] }]] },
  });
  const created = await fetch(`${ctx.url}/v0/management/accounts`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ api_key: "run-secret-key" }),
  });
  const { account } = (await created.json()) as { account: { id: string } };

  const response = await fetch(`${ctx.url}/v0/management/accounts/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      account_id: account.id,
      protocol: "messages",
      request: {
        model: "claude-sonnet-4-6",
        max_tokens: 128,
        stream: false,
        messages: [{ role: "user", content: "hello" }],
      },
    }),
  });
  expect(response.status).toBe(200);
  expect(ctx.sdk.lastCreate?.apiKey).toBe("run-secret-key");
  expect(await response.text()).toContain("managed console ok");
});

test("onboarding persists the session token when store_session_token is set", async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "cursor-sdk2api-onboard-"));
  stubOnboardingFetch();
  ctx = await startTestApp({ config: { stateDir } });
  const token = sessionToken();

  const response = await fetch(`${ctx.url}/v0/management/accounts/onboard`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ session_token: token, store_session_token: true }),
  });
  expect(response.status).toBe(201);
  const body = (await response.json()) as { account: { id: string } };

  const store = new CursorAccountFileStore(stateDir);
  expect(store.getSessionToken(body.account.id)).toBe(token);
});

test("onboarding does not persist the session token by default", async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "cursor-sdk2api-onboard-"));
  stubOnboardingFetch();
  ctx = await startTestApp({ config: { stateDir } });
  const token = sessionToken();

  const response = await fetch(`${ctx.url}/v0/management/accounts/onboard`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ session_token: token }),
  });
  expect(response.status).toBe(201);
  const body = (await response.json()) as { account: { id: string } };

  const store = new CursorAccountFileStore(stateDir);
  expect(store.getSessionToken(body.account.id)).toBeUndefined();
  expect(store.list().find((a) => a.id === body.account.id)?.hasSessionToken).toBe(false);
});
