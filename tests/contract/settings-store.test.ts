import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SettingsStore } from "../../src/core/settings/store.js";
import { SettingsValidationError } from "../../src/core/settings/validate.js";
import { defaultRuntimeSettings, settingsEffect } from "../../src/core/settings/schema.js";

function stateDir(): string {
  return mkdtempSync(join(tmpdir(), "settings-"));
}

describe("settings store", () => {
  it("seeds from env once, then treats the file as authoritative", () => {
    const dir = stateDir();
    new SettingsStore(dir, { globalActiveRuns: 9 });

    // A later process with a different env must not override the persisted file.
    const reopened = new SettingsStore(dir, { globalActiveRuns: 99 });
    expect(reopened.get().globalActiveRuns).toBe(9);
    expect(reopened.isSeededFromEnv()).toBe(true);
  });

  it("persists an update across reopen", () => {
    const dir = stateDir();
    new SettingsStore(dir).update({ logLevel: "debug", globalActiveRuns: 16 });
    const reopened = new SettingsStore(dir);
    expect(reopened.get().logLevel).toBe("debug");
    expect(reopened.get().globalActiveRuns).toBe(16);
  });

  it("writes 0600 and keeps a backup of the previous value", () => {
    const dir = stateDir();
    const store = new SettingsStore(dir);
    store.update({ logLevel: "warn" });
    const backups = readdirSync(dir).filter((name) => name.startsWith("config.json.bak-"));
    expect(backups.length).toBe(1);
    expect(JSON.parse(readFileSync(join(dir, backups[0]!), "utf8")).settings.logLevel).toBe("info");
  });

  it("notifies listeners after a successful write", () => {
    const store = new SettingsStore(stateDir());
    const seen: string[] = [];
    store.onChange((settings) => seen.push(settings.logLevel));
    store.update({ logLevel: "error" });
    expect(seen).toEqual(["error"]);
  });

  it("rejects the whole patch when one field is invalid", () => {
    const store = new SettingsStore(stateDir());
    expect(() => store.update({ logLevel: "debug", globalActiveRuns: 0 })).toThrow(
      SettingsValidationError,
    );
    // The valid field in the same patch must not have been applied.
    expect(store.get().logLevel).toBe("info");
  });

  it("rejects unknown and restart-only fields", () => {
    const store = new SettingsStore(stateDir());
    expect(() => store.update({ nope: 1 })).toThrow(/not a known setting/);
    expect(() => store.update({ runtimeLedgerV2: true } as never)).toThrow(/not a known setting/);
  });

  it("fails closed on a corrupt file instead of resetting to defaults", () => {
    const dir = stateDir();
    new SettingsStore(dir);
    writeFileSync(join(dir, "config.json"), "{ not json");
    expect(() => new SettingsStore(dir)).toThrow(/not valid JSON/);
  });

  it("fails closed on an unsupported version", () => {
    const dir = stateDir();
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({ version: 1, seeded_from_env: true, updated_at: 0, settings: {} }),
    );
    expect(() => new SettingsStore(dir)).toThrow(/unsupported version/);
  });

  it("clamps an out-of-range stored value rather than refusing to start", () => {
    const dir = stateDir();
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        seeded_from_env: true,
        updated_at: 0,
        settings: { ...defaultRuntimeSettings(), firstEventTimeoutMs: 10, globalActiveRuns: 9999 },
      }),
    );
    const store = new SettingsStore(dir);
    expect(store.get().firstEventTimeoutMs).toBe(5_000);
    expect(store.get().globalActiveRuns).toBe(256);
  });

  it("keeps the default when a stored field has the wrong type", () => {
    const dir = stateDir();
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        version: 2,
        seeded_from_env: true,
        updated_at: 0,
        settings: { ...defaultRuntimeSettings(), logLevel: 42, perAccountProxyEnabled: "yes" },
      }),
    );
    const store = new SettingsStore(dir);
    expect(store.get().logLevel).toBe("info");
    expect(store.get().perAccountProxyEnabled).toBe(false);
  });

  it("clamps an env seed so a short-timeout host can still start", () => {
    const store = new SettingsStore(stateDir(), { firstEventTimeoutMs: 50 });
    expect(store.get().firstEventTimeoutMs).toBe(5_000);
  });

  it("labels effect classes so the console can be honest", () => {
    expect(settingsEffect("logLevel")).toBe("hot");
    expect(settingsEffect("perAccountProxyEnabled")).toBe("hot");
    expect(settingsEffect("defaultRuntimeProfile")).toBe("new_sessions");
    expect(settingsEffect("globalProxy")).toBe("new_sessions");
  });

  it("defaults per-account proxying to off", () => {
    expect(defaultRuntimeSettings().perAccountProxyEnabled).toBe(false);
  });
});
