import type { IncomingMessage } from "node:http";
import { authenticationError } from "../errors.js";
import { credentialFingerprint } from "../digest.js";
import type { GatewayConfig } from "../config.js";
import type { RuntimeProfile } from "../core/runtime-profile.js";
import { headerValue } from "../server/http-util.js";

export interface AuthContext {
  mode: "byok" | "managed";
  cursorApiKey: string;
  fingerprint: string;
  defaultProfile?: RuntimeProfile;
  /** JWT for sand (Bot) inference, extracted from a session token. */
  sandJwt?: string;
}

export type ClientAuthorization =
  | { mode: "byok"; auth: AuthContext }
  | { mode: "managed" };

export function authorizeClient(req: IncomingMessage, config: GatewayConfig): ClientAuthorization {
  const presented = presentedSecret(req);
  if (!presented) {
    throw authenticationError("Provide Authorization: Bearer or x-api-key");
  }

  if (config.authMode === "managed") {
    if (!config.gatewayAccessKey) {
      throw authenticationError("Managed auth is not configured");
    }
    if (presented !== config.gatewayAccessKey) {
      throw authenticationError("Invalid gateway access key");
    }
    return { mode: "managed" };
  }

  const sandJwt = extractSandJwt(presented);
  return {
    mode: "byok",
    auth: {
      mode: "byok",
      cursorApiKey: presented,
      fingerprint: credentialFingerprint(presented),
      ...(sandJwt ? { sandJwt } : {}),
    },
  };
}

export function managedAccountAuth(
  apiKey: string,
  defaultProfile?: RuntimeProfile,
  sessionToken?: string,
): AuthContext {
  const sandJwt = sessionToken ? extractSandJwt(sessionToken) : undefined;
  return {
    mode: "managed",
    cursorApiKey: apiKey,
    fingerprint: credentialFingerprint(apiKey),
    ...(defaultProfile ? { defaultProfile } : {}),
    ...(sandJwt ? { sandJwt } : {}),
  };
}

/** A session token looks like `user_...::<jwt>` (possibly URL-encoded `::`). */
export function extractSandJwt(value: string): string | undefined {
  let normalized = value;
  if (/%3a%3a/i.test(value)) {
    try {
      normalized = decodeURIComponent(value);
    } catch {
      return undefined;
    }
  }
  if (!normalized.includes("::")) return undefined;
  const jwt = normalized.split("::", 2)[1] ?? "";
  return jwt.split(".").length === 3 ? jwt : undefined;
}

function presentedSecret(req: IncomingMessage): string | undefined {
  const apiKey = headerValue(req, "x-api-key");
  if (apiKey) return apiKey.trim();
  const authorization = headerValue(req, "authorization");
  if (!authorization) return undefined;
  const match = /^Bearer\s+(\S+)/i.exec(authorization);
  return match?.[1];
}
