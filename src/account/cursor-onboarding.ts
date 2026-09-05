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
 * A session token looks like `user_...::<jwt>`. We validate the shape and that
 * the JWT self-declares `type: session` before spending a network round trip.
 */
export function looksLikeSessionToken(value: string): boolean {
  const trimmed = value.trim();
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
  request?: Fetch;
}

/**
 * Exchange a browser session token for a persistent `crsr_...` User API Key,
 * optionally granting Fable 5 consent. The session token is not returned and
 * must not be persisted by the caller.
 */
export async function onboardCursorAccount(options: OnboardingOptions): Promise<OnboardingResult> {
  const sessionToken = options.sessionToken.trim();
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

  return { apiKey, keyName, fable5 };
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

export { credentialFingerprint };
