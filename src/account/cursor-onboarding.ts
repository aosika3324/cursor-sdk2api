import { credentialFingerprint } from "../digest.js";

/**
 * One-shot account onboarding against cursor.com's dashboard web API.
 *
 * This is deliberately separated from the SDK data plane. A browser session
 * token (`WorkosCursorSessionToken`) is accepted ONLY to mint a real
 * `crsr_...` User API Key and, optionally, to grant Fable 5 data-retention
 * consent. The session token is used for these calls and then discarded; it is
 * never stored and never reaches any SDK request. Only the resulting
 * `crsr_...` key is persisted by the caller.
 *
 * Request shapes were captured from the real dashboard flow.
 */

const DASHBOARD_ORIGIN = "https://cursor.com";
const REQUEST_TIMEOUT_MS = 15_000;
const FABLE5_MODEL_ID = "claude-fable-5";
const FABLE5_CONSENT_VERSION = "fable-data-retention-v1";

export interface OnboardingResult {
  apiKey: string;
  keyName: string;
  fable5: "granted" | "already" | "skipped" | "failed";
  sand?: SandClaimResult;
}

export type OnboardingFailureReason =
  | "invalid_session_token_format"
  | "session_unauthorized"
  | "account_closed"
  | "api_key_access_denied"
  | "create_key_failed"
  | "dashboard_unreachable"
  | "dashboard_invalid_response";

export class OnboardingError extends Error {
  constructor(readonly reason: OnboardingFailureReason, readonly status?: number) {
    super(`cursor onboarding failed: ${reason}${status ? ` (${status})` : ""}`);
    this.name = "OnboardingError";
  }
}

/**
 * Session tokens are often copied URL-encoded (the `::` shows up as `%3A%3A`
 * from an address bar or cookie panel). Normalize before validating or using.
 */
export function normalizeSessionToken(value: string): string {
  const trimmed = value.trim();
  if (trimmed.includes("::")) return trimmed;
  if (/%3a%3a/i.test(trimmed)) {
    try {
      return decodeURIComponent(trimmed);
    } catch {
      return trimmed;
    }
  }
  return trimmed;
}

/**
 * A session token looks like `user_...::<jwt>`. We validate the shape and that
 * the JWT self-declares `type: session` before spending a network round trip.
 */
export function looksLikeSessionToken(value: string): boolean {
  const trimmed = normalizeSessionToken(value);
  if (!trimmed.includes("::")) return false;
  const [, jwt] = trimmed.split("::", 2);
  const parts = jwt?.split(".") ?? [];
  return parts.length === 3;
}

function decodeSessionType(token: string): string | undefined {
  try {
    const jwt = token.split("::", 2)[1] ?? "";
    const payload = jwt.split(".")[1] ?? "";
    const json = Buffer.from(payload, "base64url").toString("utf8");
    return (JSON.parse(json) as { type?: string }).type;
  } catch {
    return undefined;
  }
}

type Fetch = typeof globalThis.fetch;

async function dashboardCall(
  path: string,
  sessionToken: string,
  body: unknown,
  request: Fetch,
): Promise<{ status: number; json: Record<string, unknown> }> {
  let response: Response;
  try {
    response = await request(`${DASHBOARD_ORIGIN}/api/dashboard/${path}`, {
      method: "POST",
      redirect: "manual",
      headers: {
        // Session cookie is the dashboard's auth. Origin/referer satisfy the
        // CSRF origin check the dashboard enforces on state-changing routes.
        cookie: `WorkosCursorSessionToken=${sessionToken}`,
        "content-type": "application/json",
        origin: DASHBOARD_ORIGIN,
        referer: `${DASHBOARD_ORIGIN}/dashboard/api?section=user-keys`,
        "user-agent": "cursor-sdk2api-onboarding",
      },
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (cause) {
    throw new OnboardingError("dashboard_unreachable");
  }
  // A redirect (3xx) or an HTML body means the session was not accepted and the
  // dashboard bounced us to a login page.
  const contentType = response.headers.get("content-type") ?? "";
  if (response.status >= 300 && response.status < 400) {
    throw new OnboardingError("session_unauthorized", response.status);
  }
  const text = await response.text();
  if (!contentType.includes("application/json")) {
    throw new OnboardingError("session_unauthorized", response.status);
  }
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new OnboardingError("dashboard_invalid_response", response.status);
  }
  // Cursor signals a disabled account with a stable error code even under 200.
  const errorCode = JSON.stringify(json);
  if (errorCode.includes("ACCOUNT_CLOSED")) {
    throw new OnboardingError("account_closed", response.status);
  }
  if (response.status === 401 || errorCode.includes("NOT_LOGGED_IN")) {
    throw new OnboardingError("session_unauthorized", response.status);
  }
  return { status: response.status, json };
}


export interface OnboardingOptions {
  sessionToken: string;
  keyName?: string;
  grantFable5?: boolean;
  claimSand?: boolean;
  request?: Fetch;
}

/**
 * Exchange a browser session token for a persistent `crsr_...` User API Key,
 * optionally granting Fable 5 consent. The session token is not returned and
 * must not be persisted by the caller.
 */
export async function onboardCursorAccount(options: OnboardingOptions): Promise<OnboardingResult> {
  const sessionToken = normalizeSessionToken(options.sessionToken);
  if (!looksLikeSessionToken(sessionToken)) {
    throw new OnboardingError("invalid_session_token_format");
  }
  if (decodeSessionType(sessionToken) !== "session") {
    // A crsr_ key or anything else is not exchangeable here.
    throw new OnboardingError("invalid_session_token_format");
  }
  const request = options.request ?? globalThis.fetch;

  // 1. Confirm the account may create keys before spending the create call.
  const access = await dashboardCall("check-user-api-key-access", sessionToken, {}, request);
  if (access.json.hasAccess !== true) {
    throw new OnboardingError("api_key_access_denied", access.status);
  }

  // 2. Mint the key. expiresAt is omitted for a non-expiring key.
  const keyName = (options.keyName?.trim() || `gateway-${Date.now()}`).slice(0, 64);
  const created = await dashboardCall(
    "create-user-api-key",
    sessionToken,
    { name: keyName },
    request,
  );
  const apiKey = typeof created.json.apiKey === "string" ? created.json.apiKey.trim() : "";
  if (!apiKey.startsWith("crsr_")) {
    throw new OnboardingError("create_key_failed", created.status);
  }

  // 3. Optionally grant Fable 5 data-retention consent (no-ZDR).
  let fable5: OnboardingResult["fable5"] = "skipped";
  if (options.grantFable5) {
    fable5 = await grantFable5Consent(sessionToken, request);
  }

  // 4. Optionally claim Grok Bot (Sand) entitlement.
  let sand: SandClaimResult | undefined;
  if (options.claimSand) {
    sand = await claimSand(sessionToken, request);
  }

  return { apiKey, keyName, fable5, ...(sand ? { sand } : {}) };
}

/**
 * Grant (or confirm) Fable 5 data-retention consent for this account. Returns
 * "already" when the consent is present, "granted" when newly set, "failed" on
 * a soft error that should not abort a successful key creation.
 */
export async function grantFable5Consent(
  sessionToken: string,
  request: Fetch = globalThis.fetch,
): Promise<"granted" | "already" | "failed"> {
  try {
    const status = await dashboardCall(
      "get-no-zdr-model-consent-status",
      sessionToken,
      { scope: "SCOPE_USER" },
      request,
    );
    const consents = Array.isArray(status.json.consents) ? status.json.consents : [];
    const has = consents.some(
      (c) => (c as { modelId?: string }).modelId === FABLE5_MODEL_ID,
    );
    if (has) return "already";

    const set = await dashboardCall(
      "set-user-no-zdr-model-consent",
      sessionToken,
      {
        modelId: FABLE5_MODEL_ID,
        enabled: true,
        acknowledged: true,
        consentVersion: FABLE5_CONSENT_VERSION,
      },
      request,
    );
    return set.json.consented === true ? "granted" : "failed";
  } catch {
    // Key creation already succeeded; a consent hiccup is not fatal.
    return "failed";
  }
}

export type SandClaimOutcome =
  | "already"
  | "team_ok"
  | "activated"
  | "card_required"
  | "dead"
  | "failed";

export interface SandClaimResult {
  outcome: SandClaimOutcome;
  teamId?: number;
  detail?: string;
  cardUrl?: string;
}

/**
 * Claim Grok Bot (Sand) entitlement for the account behind this session token,
 * mirroring SandClaimer's decision tree:
 *
 *   granted/unlocked        -> already
 *   team account (teamId)   -> request-sand-team-access + onboarding mark
 *   personal, activatable   -> start-sand-trial
 *   personal, free tier     -> card_required (stripe url)
 *   token dead (401/403)    -> dead
 *
 * Never throws: a claim failure must not abort a key exchange that already
 * succeeded. Returns a typed outcome instead.
 */
export async function claimSand(
  sessionToken: string,
  request: Fetch = globalThis.fetch,
): Promise<SandClaimResult> {
  const token = normalizeSessionToken(sessionToken);
  const soft = async (path: string, body: unknown) => {
    try {
      return await dashboardCall(path, token, body, request);
    } catch (error) {
      if (error instanceof OnboardingError) {
        return { status: 0, json: { __error: error.reason } as Record<string, unknown> };
      }
      throw error;
    }
  };

  // 1. Authoritative access status. A dead token shows up as unauthorized.
  const access = await soft("get-sand-access-status", {});
  if (access.json.__error === "account_closed") return { outcome: "dead", detail: "account_closed" };
  if (access.status === 401 || access.json.__error === "session_unauthorized") {
    return { outcome: "dead", detail: "session_unauthorized" };
  }
  const state = typeof access.json.state === "string" ? access.json.state : "";
  const planGrants = access.json.proAndSuperGrokPlansGrantAccess === true;
  if (state === "SAND_ACCESS_STATE_GRANTED" || planGrants) {
    return { outcome: "already", detail: state || "plan_grants_access" };
  }

  // 2. Resolve teamId to pick the team vs personal path.
  const me = await soft("get-me", {});
  const rawTeam = me.json.teamId;
  const teamId = typeof rawTeam === "number" && rawTeam > 0 ? rawTeam : undefined;

  if (teamId !== undefined) {
    const team = await soft("request-sand-team-access", { teamId });
    if (team.status === 200) {
      // Idempotent onboarding mark; failure here does not change the outcome.
      await soft("update-team-sand-onboarding-completed", { teamId });
      return { outcome: "team_ok", teamId, detail: "team access requested" };
    }
    return { outcome: "failed", teamId, detail: `team request HTTP ${team.status}` };
  }

  // 3. Personal trial.
  const trial = await soft("start-sand-trial", {});
  if (trial.status !== 200) {
    return { outcome: "failed", detail: `trial HTTP ${trial.status}` };
  }
  const blob = JSON.stringify(trial.json).toLowerCase();
  if (blob.includes("cardverificationrequired") || blob.includes("card_verification")) {
    const match = /"(https:\/\/[^"]*(?:checkout|stripe)[^"]*)"/.exec(JSON.stringify(trial.json));
    return { outcome: "card_required", cardUrl: match?.[1], detail: "card verification required" };
  }
  return { outcome: "activated", detail: "personal trial activated" };
}

export { credentialFingerprint };
