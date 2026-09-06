import { afterEach, expect, test } from "vitest";
import { closeTestApp, startTestApp, type TestContext } from "../helpers/app.js";
import { LogSink } from "../../src/core/log-sink.js";

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

async function login(url: string): Promise<string> {
  const res = await fetch(`${url}/v0/management/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ access_key: "secret-key" }),
  });
  expect(res.status).toBe(200);
  const setCookie = res.headers.get("set-cookie") ?? "";
  const match = /bf_console_session=([^;]*)/.exec(setCookie);
  expect(match).toBeTruthy();
  return match?.[1] ?? "";
}

test("PUT then GET logs capacity round-trips a valid step", async () => {
  ctx = await startTestApp({ config: MANAGED });
  const token = await login(ctx.url);
  const cookie = `bf_console_session=${token}`;

  const put = await fetch(`${ctx.url}/v0/management/logs/capacity`, {
    method: "PUT",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ capacity: 100 }),
  });
  expect(put.status).toBe(200);
  expect(await put.json()).toEqual({ capacity: 100 });

  const get = await fetch(`${ctx.url}/v0/management/logs/capacity`, {
    headers: { cookie },
  });
  expect(get.status).toBe(200);
  expect(await get.json()).toEqual({ capacity: 100, steps: [20, 30, 50, 100, 200, 300] });
});

test("PUT logs capacity rejects an invalid step", async () => {
  ctx = await startTestApp({ config: MANAGED });
  const token = await login(ctx.url);
  const cookie = `bf_console_session=${token}`;

  const put = await fetch(`${ctx.url}/v0/management/logs/capacity`, {
    method: "PUT",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ capacity: 7 }),
  });
  expect(put.status).toBe(400);
  expect(await put.json()).toEqual({ error: "invalid capacity" });
});

test("activity stats reports a numeric rpm", async () => {
  ctx = await startTestApp({ config: MANAGED });
  const token = await login(ctx.url);
  const cookie = `bf_console_session=${token}`;

  const res = await fetch(`${ctx.url}/v0/management/activity/stats`, {
    headers: { cookie },
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { rpm?: unknown };
  expect(typeof body.rpm).toBe("number");
});

test("logs stream responds with an SSE content-type", async () => {
  ctx = await startTestApp({ config: MANAGED });
  const token = await login(ctx.url);
  const cookie = `bf_console_session=${token}`;

  const controller = new AbortController();
  const res = await fetch(`${ctx.url}/v0/management/logs/stream`, {
    headers: { cookie },
    signal: controller.signal,
  });
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("text/event-stream");
  controller.abort();
});

test("activity stream responds with an SSE content-type", async () => {
  ctx = await startTestApp({ config: MANAGED });
  const token = await login(ctx.url);
  const cookie = `bf_console_session=${token}`;

  const controller = new AbortController();
  const res = await fetch(`${ctx.url}/v0/management/activity/stream`, {
    headers: { cookie },
    signal: controller.signal,
  });
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("text/event-stream");
  controller.abort();
});

test("logs stream replays buffered entries to a new subscriber", async () => {
  const logSink = new LogSink();
  logSink.push({ level: "info", msg: "hello-replay", at: 123 });
  ctx = await startTestApp({ config: MANAGED, logSink });
  const token = await login(ctx.url);
  const cookie = `bf_console_session=${token}`;

  const controller = new AbortController();
  const res = await fetch(`${ctx.url}/v0/management/logs/stream`, {
    headers: { cookie },
    signal: controller.signal,
  });
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("text/event-stream");

  const reader = res.body?.getReader();
  expect(reader).toBeTruthy();
  const { value } = await reader!.read();
  const frame = new TextDecoder().decode(value);
  expect(frame).toContain("event: log");
  expect(frame).toContain("hello-replay");

  controller.abort();
});

test("logs capacity requires a session cookie in managed mode", async () => {
  ctx = await startTestApp({ config: MANAGED });
  const res = await fetch(`${ctx.url}/v0/management/logs/capacity`);
  expect(res.status).toBe(401);
  const body = (await res.json()) as { error?: string };
  expect(body.error).toBe("unauthorized");
});
