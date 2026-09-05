import { describe, expect, it, vi } from "vitest";
import {
  claimSand,
  looksLikeSessionToken,
  onboardCursorAccount,
  OnboardingError,
} from "../../src/account/cursor-onboarding.js";

// A minimal session token: user_x::<header>.<payload>.<sig> with type=session.
function sessionToken(type = "session"): string {
  const payload = Buffer.from(JSON.stringify({ sub: "u", type })).toString("base64url");
  return `user_x::h.${payload}.sig`;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("session token detection", () => {
  it("accepts the user::jwt shape and rejects a plain key", () => {
    expect(looksLikeSessionToken(sessionToken())).toBe(true);
    expect(looksLikeSessionToken("crsr_abc123")).toBe(false);
    expect(looksLikeSessionToken("user_x::not-a-jwt")).toBe(false);
  });

  it("accepts a URL-encoded token where :: became %3A%3A", () => {
    const encoded = sessionToken().replace("::", "%3A%3A");
    expect(encoded).not.toContain("::");
    expect(looksLikeSessionToken(encoded)).toBe(true);
  });
});

describe("onboardCursorAccount", () => {
  it("rejects a non-session token before any network call", async () => {
    const request = vi.fn();
    await expect(
      onboardCursorAccount({ sessionToken: "crsr_already_a_key", request: request as never }),
    ).rejects.toMatchObject({ reason: "invalid_session_token_format" });
    expect(request).not.toHaveBeenCalled();
  });

  it("exchanges a session token for a crsr_ key", async () => {
    const request = vi.fn(async (url: string) => {
      if (url.endsWith("check-user-api-key-access")) return jsonResponse({ hasAccess: true });
      if (url.endsWith("create-user-api-key")) return jsonResponse({ apiKey: "crsr_minted" });
      throw new Error(`unexpected url ${url}`);
    });
    const result = await onboardCursorAccount({
      sessionToken: sessionToken(),
      request: request as never,
    });
    expect(result.apiKey).toBe("crsr_minted");
    expect(result.fable5).toBe("skipped");
  });

  it("grants Fable 5 when asked and reports the outcome", async () => {
    const request = vi.fn(async (url: string) => {
      if (url.endsWith("check-user-api-key-access")) return jsonResponse({ hasAccess: true });
      if (url.endsWith("create-user-api-key")) return jsonResponse({ apiKey: "crsr_minted" });
      if (url.endsWith("get-no-zdr-model-consent-status")) return jsonResponse({ consents: [] });
      if (url.endsWith("set-user-no-zdr-model-consent")) return jsonResponse({ consented: true });
      throw new Error(`unexpected url ${url}`);
    });
    const result = await onboardCursorAccount({
      sessionToken: sessionToken(),
      grantFable5: true,
      request: request as never,
    });
    expect(result.fable5).toBe("granted");
  });

  it("reports Fable 5 as already granted when consent exists", async () => {
    const request = vi.fn(async (url: string) => {
      if (url.endsWith("check-user-api-key-access")) return jsonResponse({ hasAccess: true });
      if (url.endsWith("create-user-api-key")) return jsonResponse({ apiKey: "crsr_minted" });
      if (url.endsWith("get-no-zdr-model-consent-status")) {
        return jsonResponse({ consents: [{ modelId: "claude-fable-5" }] });
      }
      throw new Error(`unexpected url ${url}`);
    });
    const result = await onboardCursorAccount({
      sessionToken: sessionToken(),
      grantFable5: true,
      request: request as never,
    });
    expect(result.fable5).toBe("already");
  });

  it("maps a closed account to a clear reason", async () => {
    const request = vi.fn(async () =>
      jsonResponse({ error: { details: [{ error: "ERROR_ACCOUNT_CLOSED" }] } }, 401),
    );
    await expect(
      onboardCursorAccount({ sessionToken: sessionToken(), request: request as never }),
    ).rejects.toMatchObject({ reason: "account_closed" });
  });

  it("treats an HTML login redirect as unauthorized", async () => {
    const request = vi.fn(
      async () => new Response("<!DOCTYPE html>", { status: 200, headers: { "content-type": "text/html" } }),
    );
    await expect(
      onboardCursorAccount({ sessionToken: sessionToken(), request: request as never }),
    ).rejects.toMatchObject({ reason: "session_unauthorized" });
  });

  it("fails when the account cannot create keys", async () => {
    const request = vi.fn(async () => jsonResponse({ hasAccess: false }));
    await expect(
      onboardCursorAccount({ sessionToken: sessionToken(), request: request as never }),
    ).rejects.toMatchObject({ reason: "api_key_access_denied" });
  });

  it("never returns the session token in the result", async () => {
    const token = sessionToken();
    const request = vi.fn(async (url: string) => {
      if (url.endsWith("check-user-api-key-access")) return jsonResponse({ hasAccess: true });
      return jsonResponse({ apiKey: "crsr_minted" });
    });
    const result = await onboardCursorAccount({ sessionToken: token, request: request as never });
    expect(JSON.stringify(result)).not.toContain(token);
    expect(JSON.stringify(result)).not.toContain("::");
  });
});

describe("claimSand", () => {
  function router(map: Record<string, () => Response>) {
    return vi.fn(async (url: string) => {
      for (const [key, fn] of Object.entries(map)) {
        if (url.endsWith(key)) return fn();
      }
      throw new Error(`unexpected url ${url}`);
    });
  }

  it("reports already when the plan grants access", async () => {
    const request = router({
      "get-sand-access-status": () => jsonResponse({ proAndSuperGrokPlansGrantAccess: true }),
    });
    const r = await claimSand(sessionToken(), request as never);
    expect(r.outcome).toBe("already");
  });

  it("reports already when state is granted", async () => {
    const request = router({
      "get-sand-access-status": () => jsonResponse({ state: "SAND_ACCESS_STATE_GRANTED" }),
    });
    expect((await claimSand(sessionToken(), request as never)).outcome).toBe("already");
  });

  it("takes the team path when a teamId is present", async () => {
    const request = router({
      "get-sand-access-status": () => jsonResponse({ state: "SAND_ACCESS_STATE_NONE" }),
      "get-me": () => jsonResponse({ teamId: 4242, email: "t@x.co" }),
      "request-sand-team-access": () => jsonResponse({ ok: true }),
      "update-team-sand-onboarding-completed": () => jsonResponse({ ok: true }),
    });
    const r = await claimSand(sessionToken(), request as never);
    expect(r).toMatchObject({ outcome: "team_ok", teamId: 4242 });
  });

  it("starts a personal trial when there is no team", async () => {
    const request = router({
      "get-sand-access-status": () => jsonResponse({ state: "SAND_ACCESS_STATE_NONE" }),
      "get-me": () => jsonResponse({ teamId: 0 }),
      "start-sand-trial": () => jsonResponse({ activated: true }),
    });
    expect((await claimSand(sessionToken(), request as never)).outcome).toBe("activated");
  });

  it("reports card_required for a free account", async () => {
    const request = router({
      "get-sand-access-status": () => jsonResponse({ state: "SAND_ACCESS_STATE_NONE" }),
      "get-me": () => jsonResponse({ teamId: 0 }),
      "start-sand-trial": () =>
        jsonResponse({ cardVerificationRequired: true, url: "https://checkout.stripe.com/x" }),
    });
    const r = await claimSand(sessionToken(), request as never);
    expect(r.outcome).toBe("card_required");
    expect(r.cardUrl).toBe("https://checkout.stripe.com/x");
  });

  it("reports dead when the token is unauthorized", async () => {
    const request = router({
      "get-sand-access-status": () =>
        jsonResponse({ error: { details: [{ error: "NOT_LOGGED_IN" }] } }, 401),
    });
    expect((await claimSand(sessionToken(), request as never)).outcome).toBe("dead");
  });

  it("never throws on a soft failure mid-flow", async () => {
    const request = router({
      "get-sand-access-status": () => jsonResponse({ state: "SAND_ACCESS_STATE_NONE" }),
      "get-me": () => jsonResponse({ teamId: 7 }),
      "request-sand-team-access": () => jsonResponse({ error: "nope" }, 500),
      "update-team-sand-onboarding-completed": () => jsonResponse({}),
    });
    const r = await claimSand(sessionToken(), request as never);
    expect(r.outcome).toBe("failed");
  });
});
