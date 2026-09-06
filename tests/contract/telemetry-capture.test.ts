import { afterEach, expect, test } from "vitest";
import { RequestTelemetry } from "../../src/core/request-telemetry.js";
import { api, closeTestApp, startTestApp, type TestContext } from "../helpers/app.js";

let ctx: TestContext | undefined;

afterEach(async () => {
  if (ctx) await closeTestApp(ctx);
  ctx = undefined;
});

test("records a telemetry entry for /v1/messages with client IP and status", async () => {
  const telemetry = new RequestTelemetry();
  ctx = await startTestApp({
    sdk: { scripts: [[{ type: "text", chunks: ["hi"] }]] },
    telemetry,
  });
  const res = await api(ctx, "/v1/messages", {
    method: "POST",
    headers: { "x-forwarded-for": "9.9.9.9" },
    body: JSON.stringify({
      model: "composer-2.5",
      max_tokens: 32,
      messages: [{ role: "user", content: "hi" }],
    }),
  });
  expect(res.status).toBe(200);
  const rec = telemetry.recent();
  expect(rec).toHaveLength(1);
  expect(rec[0]!.clientIp).toBe("9.9.9.9");
  expect(rec[0]!.status).toBe(200);
  expect(rec[0]!.model).toBe("composer-2.5");
  expect(rec[0]!.durationMs).toBeGreaterThanOrEqual(0);
});

test("records a telemetry entry with the error status when the request fails", async () => {
  const telemetry = new RequestTelemetry();
  ctx = await startTestApp({
    sdk: { scripts: [[{ type: "send-error", message: "Model not available: provider is not supported in your region" }]] },
    telemetry,
  });
  const res = await api(ctx, "/v1/messages", {
    method: "POST",
    headers: { "x-forwarded-for": "9.9.9.9" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 16,
      messages: [{ role: "user", content: "hi" }],
    }),
  });
  expect(res.status).toBe(403);
  const rec = telemetry.recent();
  expect(rec).toHaveLength(1);
  expect(rec[0]!.status).toBe(403);
  expect(rec[0]!.clientIp).toBe("9.9.9.9");
});
