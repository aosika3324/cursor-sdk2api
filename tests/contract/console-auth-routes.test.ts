import { afterEach, expect, test } from "vitest";
import { closeTestApp, startTestApp, type TestContext } from "../helpers/app.js";

let ctx: TestContext | undefined;

afterEach(async () => {
  if (ctx) await closeTestApp(ctx);
  ctx = undefined;
});

const MANAGED = {
  authMode: "managed" as const,
  gatewayAccessKey: "secret-key",
  managedCursorKey: undefined,
};

function extractToken(setCookie: string | null): string {
  expect(setCookie).toBeTruthy();
  expect(setCookie).toContain("bf_console_session=");
  const match = /bf_console_session=([^;]*)/.exec(setCookie ?? "");
  expect(match).toBeTruthy();
  return match?.[1] ?? "";
}

test("management routes require a session cookie in managed mode", async () => {
  ctx = await startTestApp({ config: MANAGED });
  const res = await fetch(`${ctx.url}/v0/management/accounts`);
  expect(res.status).toBe(401);
  const body = (await res.json()) as { error?: string };
  expect(body.error).toBe("unauthorized");
});

test("login with the wrong access key is rejected", async () => {
  ctx = await startTestApp({ config: MANAGED });
  const res = await fetch(`${ctx.url}/v0/management/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ access_key: "nope" }),
  });
  expect(res.status).toBe(401);
  const body = (await res.json()) as { error?: string };
  expect(body.error).toBe("invalid access key");
});

test("login mints a session that unlocks management routes", async () => {
  ctx = await startTestApp({ config: MANAGED });
  const login = await fetch(`${ctx.url}/v0/management/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ access_key: "secret-key" }),
  });
  expect(login.status).toBe(200);
  const setCookie = login.headers.get("set-cookie");
  const token = extractToken(setCookie);
  expect(setCookie).toContain("HttpOnly");
  expect(setCookie).toContain("SameSite=Strict");
  expect(setCookie).toContain("Path=/");

  const accounts = await fetch(`${ctx.url}/v0/management/accounts`, {
    headers: { cookie: `bf_console_session=${token}` },
  });
  expect(accounts.status).toBe(200);

  const session = await fetch(`${ctx.url}/v0/management/auth/session`, {
    headers: { cookie: `bf_console_session=${token}` },
  });
  expect(session.status).toBe(200);
  expect(await session.json()).toEqual({ authenticated: true });
});

test("session endpoint reports false without a cookie", async () => {
  ctx = await startTestApp({ config: MANAGED });
  const session = await fetch(`${ctx.url}/v0/management/auth/session`);
  expect(session.status).toBe(200);
  expect(await session.json()).toEqual({ authenticated: false });
});

test("logout destroys the session", async () => {
  ctx = await startTestApp({ config: MANAGED });
  const login = await fetch(`${ctx.url}/v0/management/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ access_key: "secret-key" }),
  });
  const token = extractToken(login.headers.get("set-cookie"));

  const logout = await fetch(`${ctx.url}/v0/management/auth/logout`, {
    method: "POST",
    headers: { cookie: `bf_console_session=${token}` },
  });
  expect(logout.status).toBe(200);
  expect(await logout.json()).toEqual({ ok: true });
  const clearCookie = logout.headers.get("set-cookie");
  expect(clearCookie).toContain("bf_console_session=");
  expect(clearCookie).toContain("Max-Age=0");

  const session = await fetch(`${ctx.url}/v0/management/auth/session`, {
    headers: { cookie: `bf_console_session=${token}` },
  });
  expect(await session.json()).toEqual({ authenticated: false });
});

test("login is unavailable in byok mode", async () => {
  ctx = await startTestApp();
  const res = await fetch(`${ctx.url}/v0/management/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ access_key: "whatever" }),
  });
  expect(res.status).toBe(501);
});
