import { describe, expect, it } from "vitest";
import {
  ConsoleSessionStore, CONSOLE_COOKIE, parseCookie, serializeSessionCookie,
} from "../../src/server/console-auth.js";

describe("ConsoleSessionStore", () => {
  it("creates a token that validates before expiry and fails after", () => {
    const store = new ConsoleSessionStore(1000); // ttlMs = 1000
    const now = 10_000;
    const token = store.create(now);
    expect(token).toMatch(/^[0-9a-f]{32,}$/);
    expect(store.validate(token, now + 500)).toBe(true);
    expect(store.validate(token, now + 2000)).toBe(false);
  });

  it("rejects unknown or destroyed tokens", () => {
    const store = new ConsoleSessionStore();
    const now = 0;
    const token = store.create(now);
    expect(store.validate("nope", now)).toBe(false);
    store.destroy(token);
    expect(store.validate(token, now)).toBe(false);
  });
});

describe("cookie helpers", () => {
  it("parses a named cookie from a header", () => {
    expect(parseCookie("a=1; bf_console_session=abc; b=2", CONSOLE_COOKIE)).toBe("abc");
    expect(parseCookie("", CONSOLE_COOKIE)).toBeUndefined();
    expect(parseCookie("other=x", CONSOLE_COOKIE)).toBeUndefined();
  });

  it("serializes a hardened session cookie", () => {
    const c = serializeSessionCookie("tok", { secure: true });
    expect(c).toContain(`${CONSOLE_COOKIE}=tok`);
    expect(c).toContain("HttpOnly");
    expect(c).toContain("SameSite=Strict");
    expect(c).toContain("Path=/");
    expect(c).toContain("Secure");
    const insecure = serializeSessionCookie("tok", { secure: false });
    expect(insecure).not.toContain("Secure");
  });

  it("serializes an expiring clear cookie", () => {
    const c = serializeSessionCookie("", { secure: false, maxAge: 0 });
    expect(c).toContain("Max-Age=0");
  });
});
