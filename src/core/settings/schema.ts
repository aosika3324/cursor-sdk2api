import { boundRuntimeProfile, type RuntimeProfile } from "../runtime-profile.js";

/** How a settings field takes effect. The console must label these honestly. */
export type SettingsEffect = "hot" | "new_sessions" | "restart";

export interface ProxyCredentials {
  url: string;
  username?: string;
  password?: string;
}

export interface RuntimeSettings {
  logLevel: string;
  hostedSearchMode: "off" | "auto";
  globalActiveRuns: number;
  perCredentialActiveRuns: number;
  sessionTtlMs: number;
  replayTtlMs: number;
  firstEventTimeoutMs: number;
  toolBatchSettleMs: number;
  catalogCacheMs: number;
  perAccountProxyEnabled: boolean;
  defaultRuntimeProfile: RuntimeProfile;
  allowRequestRuntimeProfile: boolean;
  globalProxy: ProxyCredentials | null;
}

export interface SettingsFieldSpec {
  key: keyof RuntimeSettings;
  effect: SettingsEffect;
  type: "string" | "number" | "boolean" | "enum" | "proxy";
  min?: number;
  max?: number;
  values?: readonly string[];
}

const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;

/**
 * Field metadata drives the console UI, so adding a setting does not require a
 * matching frontend change. Restart-only fields are served read-only.
 */
export const SETTINGS_SCHEMA: readonly SettingsFieldSpec[] = [
  { key: "logLevel", effect: "hot", type: "enum", values: LOG_LEVELS },
  { key: "hostedSearchMode", effect: "hot", type: "enum", values: ["off", "auto"] },
  { key: "globalActiveRuns", effect: "hot", type: "number", min: 1, max: 256 },
  { key: "perCredentialActiveRuns", effect: "hot", type: "number", min: 1, max: 64 },
  { key: "sessionTtlMs", effect: "hot", type: "number", min: 5 * 60_000, max: 60 * 60_000 },
  { key: "replayTtlMs", effect: "hot", type: "number", min: 60_000, max: 60 * 60_000 },
  { key: "firstEventTimeoutMs", effect: "hot", type: "number", min: 5_000, max: 600_000 },
  { key: "toolBatchSettleMs", effect: "hot", type: "number", min: 100, max: 30_000 },
  { key: "catalogCacheMs", effect: "hot", type: "number", min: 0, max: 60 * 60_000 },
  { key: "perAccountProxyEnabled", effect: "hot", type: "boolean" },
  { key: "defaultRuntimeProfile", effect: "new_sessions", type: "enum", values: ["sdk", "sand"] },
  { key: "allowRequestRuntimeProfile", effect: "new_sessions", type: "boolean" },
  { key: "globalProxy", effect: "new_sessions", type: "proxy" },
];

export const SETTINGS_VERSION = 2 as const;

export function settingsEffect(key: keyof RuntimeSettings): SettingsEffect {
  return SETTINGS_SCHEMA.find((field) => field.key === key)?.effect ?? "restart";
}

export function defaultRuntimeSettings(): RuntimeSettings {
  return {
    logLevel: "info",
    hostedSearchMode: "off",
    globalActiveRuns: 4,
    perCredentialActiveRuns: 2,
    sessionTtlMs: 30 * 60_000,
    replayTtlMs: 10 * 60_000,
    firstEventTimeoutMs: 40_000,
    toolBatchSettleMs: 1_500,
    catalogCacheMs: 5 * 60_000,
    perAccountProxyEnabled: false,
    defaultRuntimeProfile: "sdk",
    allowRequestRuntimeProfile: false,
    globalProxy: null,
  };
}

export function boundRuntimeSettingsProfile(value: unknown): RuntimeProfile {
  return boundRuntimeProfile(value === "sand" ? "sand" : "sdk");
}
