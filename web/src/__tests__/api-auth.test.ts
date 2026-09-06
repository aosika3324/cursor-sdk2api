import { afterEach, describe, expect, it, vi } from "vitest";
import { getManagedAccounts, getSession, login, logout, UnauthorizedError } from "../api";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("management auth api", () => {
  it("login posts access_key with same-origin credentials and returns true on 200", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await login("secret-key");

    expect(result).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/v0/management/auth/login");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("same-origin");
    expect(JSON.parse(init.body as string)).toEqual({ access_key: "secret-key" });
    const headers = new Headers(init.headers);
    expect(headers.get("content-type")).toBe("application/json");
  });

  it("login returns false on 401", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(401, { error: "invalid access key" })));
    expect(await login("wrong")).toBe(false);
  });

  it("login throws on other error statuses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(501, { error: "unavailable" })));
    await expect(login("x")).rejects.toThrow();
  });

  it("logout posts to the logout endpoint with same-origin credentials", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await logout();

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/v0/management/auth/logout");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("same-origin");
  });

  it("getSession returns json.authenticated", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { authenticated: true })));
    expect(await getSession()).toBe(true);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { authenticated: false })));
    expect(await getSession()).toBe(false);
  });

  it("a management fetch returning 401 throws UnauthorizedError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(401, { error: "unauthorized" })));
    await expect(getManagedAccounts()).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("management fetches include same-origin credentials", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { accounts: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await getManagedAccounts();
    const init = fetchMock.mock.calls[0]![1];
    expect(init.credentials).toBe("same-origin");
  });
});
