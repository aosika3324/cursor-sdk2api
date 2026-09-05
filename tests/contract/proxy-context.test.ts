import http from "node:http";
import https from "node:https";
import { describe, expect, it } from "vitest";
import { ProxyContext } from "../../src/core/proxy-context.js";
import { parseProxyValue, SettingsValidationError } from "../../src/core/settings/validate.js";

describe("proxy value validation", () => {
  it("accepts http, https, and socks5 schemes", () => {
    for (const url of [
      "http://127.0.0.1:7890",
      "https://proxy.example:8443",
      "socks5://127.0.0.1:1080",
      "socks5h://127.0.0.1:1080",
      "socks4://127.0.0.1:1080",
    ]) {
      expect(parseProxyValue(url, "globalProxy")?.url).toBe(url);
    }
  });

  it("rejects PAC, which cannot fail closed", () => {
    expect(() => parseProxyValue("pac+http://host/proxy.pac", "globalProxy")).toThrow(
      SettingsValidationError,
    );
  });

  it("rejects a non-URL and a missing url", () => {
    expect(() => parseProxyValue("not-a-url", "globalProxy")).toThrow(/valid absolute URL/);
    expect(() => parseProxyValue({ username: "u" }, "globalProxy")).toThrow(/url is required/);
  });

  it("treats null and empty string as no proxy", () => {
    expect(parseProxyValue(null, "globalProxy")).toBeNull();
    expect(parseProxyValue("", "globalProxy")).toBeNull();
  });

  it("carries optional credentials", () => {
    const parsed = parseProxyValue(
      { url: "http://127.0.0.1:7890", username: "u", password: "p" },
      "globalProxy",
    );
    expect(parsed).toEqual({ url: "http://127.0.0.1:7890", username: "u", password: "p" });
  });
});

describe("proxy context", () => {
  it("does not patch globals until installed", () => {
    const before = https.globalAgent;
    const context = new ProxyContext();
    expect(context.isInstalled()).toBe(false);
    expect(https.globalAgent).toBe(before);
  });

  it("isolates concurrent async contexts and falls back outside them", async () => {
    const context = new ProxyContext();
    context.install();
    try {
      const a = context.bind({ url: "http://127.0.0.1:7001" }, "acct_a");
      const b = context.bind({ url: "http://127.0.0.1:7002" }, "acct_b");

      const observe = async () => {
        // Read after an await boundary, the way the SDK would mid-request.
        await new Promise((resolve) => setTimeout(resolve, 5));
        return https.globalAgent;
      };

      const [seenA, seenB, seenNone] = await Promise.all([
        context.run(a, observe),
        context.run(b, observe),
        observe(),
      ]);

      expect(seenA).toBe(a.httpsAgent);
      expect(seenB).toBe(b.httpsAgent);
      expect(seenA).not.toBe(seenB);
      expect(seenNone).not.toBe(a.httpsAgent);
      expect(seenNone).not.toBe(b.httpsAgent);
    } finally {
      // Restore so later suites see a clean global.
      Object.defineProperty(https, "globalAgent", { value: new https.Agent(), configurable: true });
      Object.defineProperty(http, "globalAgent", { value: new http.Agent(), configurable: true });
    }
  });

  it("reuses one agent bundle per proxy target", () => {
    const context = new ProxyContext();
    const first = context.bind({ url: "http://127.0.0.1:7003" }, "acct_a");
    const second = context.bind({ url: "http://127.0.0.1:7003" }, "acct_b");
    expect(second.httpsAgent).toBe(first.httpsAgent);
    expect(context.boundProxyCount()).toBe(1);
  });

  it("gives socks and http targets different dispatchers", () => {
    const context = new ProxyContext();
    const socks = context.bind({ url: "socks5://127.0.0.1:1080" }, "acct_socks");
    const plain = context.bind({ url: "http://127.0.0.1:7890" }, "acct_http");
    expect(socks.dispatcher).not.toBe(plain.dispatcher);
    expect(context.boundProxyCount()).toBe(2);
  });

  it("runs without a binding as a plain call", () => {
    const context = new ProxyContext();
    expect(context.run(undefined, () => "ran")).toBe("ran");
  });
});
