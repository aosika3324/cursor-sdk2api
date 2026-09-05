import {
  SETTINGS_SCHEMA,
  type ProxyCredentials,
  type RuntimeSettings,
  type SettingsFieldSpec,
} from "./schema.js";

export class SettingsValidationError extends Error {
  constructor(readonly field: string, message: string) {
    super(`${field}: ${message}`);
    this.name = "SettingsValidationError";
  }
}

/** Schemes we accept. PAC needs dynamic evaluation, which cannot fail closed. */
const PROXY_SCHEMES = new Set(["http:", "https:", "socks:", "socks4:", "socks5:", "socks5h:"]);

export function parseProxyValue(raw: unknown, field: string): ProxyCredentials | null {
  if (raw == null || raw === "") return null;
  if (typeof raw === "string") return parseProxyValue({ url: raw }, field);
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new SettingsValidationError(field, "must be a proxy object or null");
  }
  const record = raw as Record<string, unknown>;
  const url = typeof record.url === "string" ? record.url.trim() : "";
  if (!url) throw new SettingsValidationError(field, "url is required");

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new SettingsValidationError(field, "url must be a valid absolute URL");
  }
  if (!PROXY_SCHEMES.has(parsed.protocol)) {
    throw new SettingsValidationError(
      field,
      `unsupported scheme ${parsed.protocol}. Expected http, https, socks, socks4, socks5, or socks5h`,
    );
  }
  if (parsed.protocol.startsWith("pac")) {
    throw new SettingsValidationError(field, "PAC proxies are not supported");
  }

  const username = readOptionalString(record.username, `${field}.username`);
  const password = readOptionalString(record.password, `${field}.password`);
  return {
    url,
    ...(username ? { username } : {}),
    ...(password ? { password } : {}),
  };
}

function readOptionalString(value: unknown, field: string): string | undefined {
  if (value == null || value === "") return undefined;
  if (typeof value !== "string") throw new SettingsValidationError(field, "must be a string");
  return value;
}

function validateField(spec: SettingsFieldSpec, value: unknown): unknown {
  const field = String(spec.key);
  switch (spec.type) {
    case "boolean": {
      if (typeof value !== "boolean") throw new SettingsValidationError(field, "must be a boolean");
      return value;
    }
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new SettingsValidationError(field, "must be a finite number");
      }
      if (!Number.isInteger(value)) throw new SettingsValidationError(field, "must be an integer");
      if (spec.min != null && value < spec.min) {
        throw new SettingsValidationError(field, `must be >= ${spec.min}`);
      }
      if (spec.max != null && value > spec.max) {
        throw new SettingsValidationError(field, `must be <= ${spec.max}`);
      }
      return value;
    }
    case "enum": {
      if (typeof value !== "string" || !spec.values?.includes(value)) {
        throw new SettingsValidationError(field, `must be one of ${spec.values?.join(", ")}`);
      }
      return value;
    }
    case "proxy":
      return parseProxyValue(value, field);
    default: {
      if (typeof value !== "string") throw new SettingsValidationError(field, "must be a string");
      return value;
    }
  }
}

/**
 * Merge a patch over current settings. Validation is all-or-nothing: an invalid
 * field rejects the whole write so the file never holds a partial update.
 */
export function applySettingsPatch(
  current: RuntimeSettings,
  patch: Record<string, unknown>,
): RuntimeSettings {
  const next: RuntimeSettings = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    const spec = SETTINGS_SCHEMA.find((candidate) => String(candidate.key) === key);
    if (!spec) throw new SettingsValidationError(key, "is not a known setting");
    if (spec.effect === "restart") {
      throw new SettingsValidationError(key, "is read-only and requires a restart to change");
    }
    (next as unknown as Record<string, unknown>)[key] = validateField(spec, value);
  }
  return next;
}

/**
 * Load persisted settings leniently.
 *
 * A stored value that falls outside the console's accepted range is clamped
 * rather than rejected: an operator (or an embedding host) may have seeded a
 * deliberately small timeout, and refusing to start would be a worse failure
 * than quietly using the nearest legal value. Structurally wrong entries —
 * unknown keys, wrong types — are dropped in favor of the current default.
 */
export function coerceStoredSettings(
  defaults: RuntimeSettings,
  stored: Record<string, unknown>,
): RuntimeSettings {
  const next: RuntimeSettings = { ...defaults };
  for (const spec of SETTINGS_SCHEMA) {
    const raw = stored[String(spec.key)];
    if (raw === undefined) continue;
    try {
      let value = validateField(spec, raw);
      next[spec.key] = value as never;
    } catch {
      if (spec.type === "number" && typeof raw === "number" && Number.isFinite(raw)) {
        const clamped = Math.min(spec.max ?? raw, Math.max(spec.min ?? raw, Math.trunc(raw)));
        next[spec.key] = clamped as never;
      }
      // Otherwise keep the default for this field.
    }
  }
  return next;
}

