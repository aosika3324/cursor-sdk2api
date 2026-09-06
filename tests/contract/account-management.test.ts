import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CursorAccountFileStore, DEFAULT_ACCOUNT_PRIORITY } from "../../src/account/file-store.js";
import { CursorAccountPool } from "../../src/auth/account-pool.js";

function store(): CursorAccountFileStore {
  return new CursorAccountFileStore(mkdtempSync(join(tmpdir(), "acct-")));
}

describe("account store v2", () => {
  it("defaults new fields so existing behavior is unchanged", () => {
    const account = store().add("key-alpha");
    expect(account.label).toBe("");
    expect(account.disabled).toBe(false);
    expect(account.priority).toBe(DEFAULT_ACCOUNT_PRIORITY);
    expect(account.proxy).toBeNull();
    expect(account.note).toBe("");
    expect(account.lastError).toBeNull();
  });

  it("migrates a v1 file in place on read and upgrades it on write", () => {
    const dir = mkdtempSync(join(tmpdir(), "acct-"));
    const authsDir = join(dir, "auths");
    const created = new CursorAccountFileStore(dir).add("key-legacy");
    // Rewrite as a v1 record, the shape shipped before this change.
    const path = join(authsDir, `${created.id}.json`);
    writeFileSync(
      path,
      JSON.stringify({
        version: 1,
        id: created.id,
        type: "cursor",
        api_key: "key-legacy",
        added_at: created.addedAt,
      }),
    );

    const reopened = new CursorAccountFileStore(dir);
    const read = reopened.get(created.id);
    expect(read?.priority).toBe(DEFAULT_ACCOUNT_PRIORITY);
    expect(read?.disabled).toBe(false);
    expect(JSON.parse(readFileSync(path, "utf8")).version).toBe(1);

    reopened.patch(created.id, { label: "primary" });
    expect(JSON.parse(readFileSync(path, "utf8")).version).toBe(2);
    expect(reopened.get(created.id)?.label).toBe("primary");
  });

  it("patches only the fields provided", () => {
    const accounts = store();
    const created = accounts.add("key-beta");
    accounts.patch(created.id, { label: "one", priority: 5 });
    accounts.patch(created.id, { note: "rotate monthly" });
    const read = accounts.get(created.id);
    expect(read?.label).toBe("one");
    expect(read?.priority).toBe(5);
    expect(read?.note).toBe("rotate monthly");
  });

  it("sets and clears a proxy", () => {
    const accounts = store();
    const created = accounts.add("key-gamma");
    accounts.setProxy(created.id, { url: "socks5://127.0.0.1:1080", username: "u" });
    expect(accounts.get(created.id)?.proxy).toEqual({
      url: "socks5://127.0.0.1:1080",
      username: "u",
    });
    accounts.setProxy(created.id, null);
    expect(accounts.get(created.id)?.proxy).toBeNull();
  });

  it("records and clears a last error", () => {
    const accounts = store();
    const created = accounts.add("key-delta");
    accounts.setLastError(created.id, { reason: "api_key_invalid", status: 401, at: 1234 });
    expect(accounts.get(created.id)?.lastError?.reason).toBe("api_key_invalid");
    accounts.setLastError(created.id, null);
    expect(accounts.get(created.id)?.lastError).toBeNull();
  });

  it("returns undefined for an unknown id instead of throwing", () => {
    expect(store().patch("acct_missing", { label: "x" })).toBeUndefined();
  });
});

describe("account pool selection", () => {
  const account = (id: string, priority: number, disabled = false) => ({
    id,
    apiKey: id,
    addedAt: 1,
    keyHint: "••••",
    defaultProfile: "sdk" as const,
    label: "",
    disabled,
    priority,
    proxy: null,
    note: "",
    lastError: null,
    hasSessionToken: false,
  });

  it("never selects a disabled account", () => {
    const pool = new CursorAccountPool();
    const accounts = [account("a", 100, true), account("b", 100)];
    for (let i = 0; i < 5; i += 1) {
      expect(pool.pick(accounts, "route")?.id).toBe("b");
    }
  });

  it("returns undefined when every account is disabled", () => {
    const pool = new CursorAccountPool();
    expect(pool.pick([account("a", 100, true)], "route")).toBeUndefined();
  });

  it("prefers the best priority tier and ignores worse tiers", () => {
    const pool = new CursorAccountPool();
    const accounts = [account("low", 200), account("high", 1)];
    for (let i = 0; i < 4; i += 1) {
      expect(pool.pick(accounts, "route")?.id).toBe("high");
    }
  });

  it("round-robins within the same tier", () => {
    const pool = new CursorAccountPool();
    const accounts = [account("a", 10), account("b", 10)];
    const seen = [
      pool.pick(accounts, "route")?.id,
      pool.pick(accounts, "route")?.id,
      pool.pick(accounts, "route")?.id,
    ];
    expect(seen).toEqual(["a", "b", "a"]);
  });

  it("falls to the next tier when the best tier is disabled", () => {
    const pool = new CursorAccountPool();
    const accounts = [account("high", 1, true), account("low", 200)];
    expect(pool.pick(accounts, "route")?.id).toBe("low");
  });

  it("reports priority tiers best first", () => {
    const pool = new CursorAccountPool();
    expect(pool.tiers([account("a", 200), account("b", 1), account("c", 1)])).toEqual([1, 200]);
  });
});
