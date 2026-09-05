import { describe, expect, it } from "vitest";
import { api, closeTestApp, startTestApp, type TestContext } from "../helpers/app.js";

async function addAccount(ctx: TestContext, key: string): Promise<string> {
  const res = await api(ctx, "/v0/management/accounts", {
    method: "POST",
    body: JSON.stringify({ api_key: key }),
  });
  return ((await res.json()) as { account: { id: string } }).account.id;
}

describe("management settings API", () => {
  it("reads settings with effect labels and no proxy secrets", async () => {
    const ctx = await startTestApp();
    try {
      const res = await api(ctx, "/v0/management/settings");
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        settings: Record<string, unknown> & {
          effects: Record<string, string>;
          globalProxy: { configured: boolean };
        };
      };
      expect(body.settings.effects.logLevel).toBe("hot");
      expect(body.settings.effects.defaultRuntimeProfile).toBe("new_sessions");
      expect(body.settings.globalProxy).toEqual({ configured: false });
      expect(body.settings.perAccountProxyEnabled).toBe(false);
    } finally {
      await closeTestApp(ctx);
    }
  });

  it("serves field metadata plus read-only restart values", async () => {
    const ctx = await startTestApp();
    try {
      const res = await api(ctx, "/v0/management/settings/schema");
      const body = (await res.json()) as {
        fields: Array<{ key: string; effect: string; type: string }>;
        restart_only: Record<string, unknown>;
      };
      expect(body.fields.some((f) => f.key === "logLevel" && f.type === "enum")).toBe(true);
      expect(body.restart_only).toHaveProperty("runtime_ledger_v2");
      expect(body.restart_only).toHaveProperty("port");
    } finally {
      await closeTestApp(ctx);
    }
  });

  it("writes a hot setting and reads it back", async () => {
    const ctx = await startTestApp();
    try {
      const res = await api(ctx, "/v0/management/settings", {
        method: "PUT",
        body: JSON.stringify({ logLevel: "warn", globalActiveRuns: 12 }),
      });
      expect(res.status).toBe(200);
      const read = await (await api(ctx, "/v0/management/settings")).json() as {
        settings: { logLevel: string; globalActiveRuns: number };
      };
      expect(read.settings.logLevel).toBe("warn");
      expect(read.settings.globalActiveRuns).toBe(12);
    } finally {
      await closeTestApp(ctx);
    }
  });

  it("rejects an out-of-range value without applying the rest of the patch", async () => {
    const ctx = await startTestApp();
    try {
      const res = await api(ctx, "/v0/management/settings", {
        method: "PUT",
        body: JSON.stringify({ logLevel: "debug", globalActiveRuns: 0 }),
      });
      expect(res.status).toBe(422);
      const read = await (await api(ctx, "/v0/management/settings")).json() as {
        settings: { logLevel: string };
      };
      expect(read.settings.logLevel).not.toBe("debug");
    } finally {
      await closeTestApp(ctx);
    }
  });

  it("refuses to write a restart-only setting through the API", async () => {
    const ctx = await startTestApp();
    try {
      const res = await api(ctx, "/v0/management/settings", {
        method: "PUT",
        body: JSON.stringify({ runtimeLedgerV2: true }),
      });
      // invalidRequest picks 400 vs 422 from the message (src/errors.ts:34).
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: { type: string } }).error.type).toBe(
        "invalid_request",
      );
    } finally {
      await closeTestApp(ctx);
    }
  });

  it("accepts a socks5 global proxy but never echoes its credentials", async () => {
    const ctx = await startTestApp();
    try {
      const res = await api(ctx, "/v0/management/settings", {
        method: "PUT",
        body: JSON.stringify({
          globalProxy: { url: "socks5://127.0.0.1:1080", username: "u", password: "secret-pw" },
        }),
      });
      expect(res.status).toBe(200);
      const raw = await (await api(ctx, "/v0/management/settings")).text();
      expect(raw).not.toContain("secret-pw");
      expect(JSON.parse(raw).settings.globalProxy).toEqual({
        configured: true,
        scheme: "socks5",
        host: "127.0.0.1:1080",
        has_username: true,
        has_password: true,
      });
    } finally {
      await closeTestApp(ctx);
    }
  });

  it("rejects a PAC proxy URL", async () => {
    const ctx = await startTestApp();
    try {
      const res = await api(ctx, "/v0/management/settings", {
        method: "PUT",
        body: JSON.stringify({ globalProxy: { url: "pac+http://host/p.pac" } }),
      });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: { type: string } }).error.type).toBe(
        "invalid_request",
      );
    } finally {
      await closeTestApp(ctx);
    }
  });
});

describe("management account API", () => {
  it("updates label, priority, disabled, and note", async () => {
    const ctx = await startTestApp();
    try {
      const id = await addAccount(ctx, "cursor-key-1");
      const res = await api(ctx, "/v0/management/accounts/update", {
        method: "PUT",
        body: JSON.stringify({ id, label: "primary", priority: 5, disabled: true, note: "spare" }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        account: { label: string; priority: number; disabled: boolean; note: string };
      };
      expect(body.account).toMatchObject({
        label: "primary",
        priority: 5,
        disabled: true,
        note: "spare",
      });
    } finally {
      await closeTestApp(ctx);
    }
  });

  it("rejects an invalid priority", async () => {
    const ctx = await startTestApp();
    try {
      const id = await addAccount(ctx, "cursor-key-2");
      const res = await api(ctx, "/v0/management/accounts/update", {
        method: "PUT",
        body: JSON.stringify({ id, priority: 5000 }),
      });
      expect(res.status).toBe(422);
    } finally {
      await closeTestApp(ctx);
    }
  });

  it("sets and clears a per-account proxy without returning the password", async () => {
    const ctx = await startTestApp();
    try {
      const id = await addAccount(ctx, "cursor-key-3");
      const set = await api(ctx, "/v0/management/accounts/proxy", {
        method: "PUT",
        body: JSON.stringify({
          id,
          proxy: { url: "http://10.0.0.1:8888", username: "u", password: "pw-secret" },
        }),
      });
      const raw = await set.text();
      expect(set.status).toBe(200);
      expect(raw).not.toContain("pw-secret");
      expect(JSON.parse(raw).account.proxy).toMatchObject({
        configured: true,
        scheme: "http",
        host: "10.0.0.1:8888",
        has_password: true,
      });

      const cleared = await api(ctx, "/v0/management/accounts/proxy", {
        method: "PUT",
        body: JSON.stringify({ id, proxy: null }),
      });
      expect(((await cleared.json()) as { account: { proxy: { configured: boolean } } }).account.proxy)
        .toEqual({ configured: false });
    } finally {
      await closeTestApp(ctx);
    }
  });

  it("returns per-item results for a batch with one bad id", async () => {
    const ctx = await startTestApp();
    try {
      const good = await addAccount(ctx, "cursor-key-4");
      const res = await api(ctx, "/v0/management/accounts/batch", {
        method: "POST",
        body: JSON.stringify({ ids: [good, "acct_missing"], action: "disable" }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { results: Array<{ id: string; ok: boolean }> };
      expect(body.results).toEqual([
        { id: good, ok: true },
        { id: "acct_missing", ok: false, reason: "not_found" },
      ]);
    } finally {
      await closeTestApp(ctx);
    }
  });

  it("rejects an unknown batch action", async () => {
    const ctx = await startTestApp();
    try {
      const id = await addAccount(ctx, "cursor-key-5");
      const res = await api(ctx, "/v0/management/accounts/batch", {
        method: "POST",
        body: JSON.stringify({ ids: [id], action: "explode" }),
      });
      expect(res.status).toBe(422);
    } finally {
      await closeTestApp(ctx);
    }
  });

  it("records a real credential probe result on verify", async () => {
    const ctx = await startTestApp();
    try {
      const id = await addAccount(ctx, "cursor-key-6");
      const res = await api(ctx, "/v0/management/accounts/verify", {
        method: "POST",
        body: JSON.stringify({ id }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { usable: boolean; account: Record<string, unknown> };
      expect(typeof body.usable).toBe("boolean");
      expect(body.account).toHaveProperty("last_error");
    } finally {
      await closeTestApp(ctx);
    }
  });
});
