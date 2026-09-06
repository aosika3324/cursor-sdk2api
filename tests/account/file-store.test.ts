import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CursorAccountFileStore } from "../../src/account/file-store.js";

describe("session token persistence", () => {
  it("stores and returns a session token, exposes only a hint publicly", () => {
    const dir = mkdtempSync(join(tmpdir(), "acct-"));
    const store = new CursorAccountFileStore(dir);
    const acct = store.add("crsr_abcd1234");
    const updated = store.setSessionToken(acct.id, "user_X::jwt.body.sig");
    expect(updated?.hasSessionToken).toBe(true);
    expect(store.getSessionToken(acct.id)).toBe("user_X::jwt.body.sig");
  });

  it("returns undefined session token when none stored", () => {
    const dir = mkdtempSync(join(tmpdir(), "acct-"));
    const store = new CursorAccountFileStore(dir);
    const acct = store.add("crsr_abcd1234");
    expect(acct.hasSessionToken).toBe(false);
    expect(store.getSessionToken(acct.id)).toBeUndefined();
  });

  it("clears a stored token when set to null", () => {
    const dir = mkdtempSync(join(tmpdir(), "acct-"));
    const store = new CursorAccountFileStore(dir);
    const acct = store.add("crsr_abcd1234");
    store.setSessionToken(acct.id, "user_X::jwt.body.sig");
    const cleared = store.setSessionToken(acct.id, null);
    expect(cleared?.hasSessionToken).toBe(false);
    expect(store.getSessionToken(acct.id)).toBeUndefined();
  });

  it("treats an empty-string token as cleared", () => {
    const dir = mkdtempSync(join(tmpdir(), "acct-"));
    const store = new CursorAccountFileStore(dir);
    const acct = store.add("crsr_abcd1234");
    store.setSessionToken(acct.id, "user_X::jwt.body.sig");
    const cleared = store.setSessionToken(acct.id, "");
    expect(cleared?.hasSessionToken).toBe(false);
    expect(store.getSessionToken(acct.id)).toBeUndefined();
  });
});
