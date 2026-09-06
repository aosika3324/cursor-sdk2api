import type { AccountPayload, HealthPayload, ModelsPayload, Protocol } from "./types.js";

export interface ManagementAccount {
  id: string;
  key_hint: string;
  added_at: number;
  default_profile?: "sdk" | "sand";
  label?: string;
  disabled?: boolean;
  priority?: number;
  note?: string;
  proxy?: {
    configured: boolean;
    scheme?: string;
    host?: string;
    has_username?: boolean;
    has_password?: boolean;
  };
  last_error?: { reason: string; status?: number; at: number } | null;
}

export type SettingsEffect = "hot" | "new_sessions" | "restart";

export interface RuntimeSettingsView {
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
  defaultRuntimeProfile: "sdk" | "sand";
  allowRequestRuntimeProfile: boolean;
  globalProxy: {
    configured: boolean;
    scheme?: string;
    host?: string;
    has_username?: boolean;
    has_password?: boolean;
  };
  effects: Record<string, SettingsEffect>;
}

export interface SettingsSchema {
  version: number;
  seeded_from_env: boolean;
  fields: Array<{
    key: string;
    effect: SettingsEffect;
    type: "string" | "number" | "boolean" | "enum" | "proxy";
    min?: number;
    max?: number;
    values?: string[];
  }>;
  restart_only: Record<string, unknown>;
}

export interface ProxyInput {
  url: string;
  username?: string;
  password?: string;
}

export interface BatchResult {
  id: string;
  ok: boolean;
  reason?: string;
}

/**
 * Raised when a management/settings request returns 401. Callers (AppState /
 * Auth) treat this as "session expired" and drop back to the login gate.
 */
export class UnauthorizedError extends Error {
  constructor(message = "unauthorized") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

/** POST /v0/management/auth/login. Returns true on 200, false on 401. */
export async function login(accessKey: string): Promise<boolean> {
  const response = await fetch("/v0/management/auth/login", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ access_key: accessKey }),
  });
  if (response.status === 200) return true;
  if (response.status === 401) return false;
  throw new Error(await errorMessage(response));
}

/** POST /v0/management/auth/logout. */
export async function logout(): Promise<void> {
  const response = await fetch("/v0/management/auth/logout", {
    method: "POST",
    credentials: "same-origin",
  });
  if (!response.ok) throw new Error(await errorMessage(response));
}

/** GET /v0/management/auth/session → whether the console cookie is valid. */
export async function getSession(): Promise<boolean> {
  const response = await fetch("/v0/management/auth/session", {
    credentials: "same-origin",
  });
  if (!response.ok) throw new Error(await errorMessage(response));
  const body = (await response.json()) as { authenticated?: boolean };
  return body.authenticated === true;
}

export async function getHealth(): Promise<HealthPayload> {
  return getJson<HealthPayload>("/health");
}

export async function getModels(apiKey: string): Promise<ModelsPayload> {
  return getJson<ModelsPayload>("/v1/models", apiKey);
}

export async function getAccount(apiKey: string): Promise<AccountPayload> {
  return getJson<AccountPayload>("/v1/account", apiKey);
}

export async function probeManagedAccount(id: string): Promise<{ models: ModelsPayload; account: AccountPayload }> {
  return managementJson<{ models: ModelsPayload; account: AccountPayload }>({
    method: "GET",
    path: `/probe?id=${encodeURIComponent(id)}`,
  });
}

export async function getManagedAccounts(): Promise<ManagementAccount[]> {
  const body = await managementJson<{ accounts: ManagementAccount[] }>({
    method: "GET",
  });
  return body.accounts;
}

export async function addManagedAccount(apiKey: string): Promise<ManagementAccount> {
  const body = await managementJson<{ account: ManagementAccount }>({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ api_key: apiKey }),
  });
  return body.account;
}

export interface OnboardResult {
  account: ManagementAccount;
  key_name: string;
  fable5: "granted" | "already" | "skipped" | "failed";
  sand?: {
    outcome: "already" | "team_ok" | "activated" | "card_required" | "dead" | "failed";
    teamId?: number;
    detail?: string;
    cardUrl?: string;
  };
}

export async function onboardManagedAccount(input: {
  sessionToken: string;
  name?: string;
  grantFable5?: boolean;
  claimSand?: boolean;
}): Promise<OnboardResult> {
  return managementJson<OnboardResult>({
    method: "POST",
    path: "/onboard",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      session_token: input.sessionToken,
      ...(input.name ? { name: input.name } : {}),
      grant_fable5: input.grantFable5 === true,
      claim_sand: input.claimSand === true,
    }),
  });
}

export async function setManagedDefaultProfile(
  id: string,
  defaultProfile: "sdk" | "sand",
): Promise<AccountPayload> {
  const body = await managementJson<{ account: AccountPayload }>({
    method: "PUT",
    path: "/default_profile",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, default_profile: defaultProfile }),
  });
  return body.account;
}

export async function removeManagedAccount(id: string): Promise<void> {
  await managementJson<{ deleted: true }>({
    method: "DELETE",
    path: `?id=${encodeURIComponent(id)}`,
  });
}

export async function runPrompt(input: {
  accountId: string;
  protocol: Protocol;
  model: string;
  prompt: string;
  stream: boolean;
  onChunk: (value: string) => void;
}): Promise<void> {
  const body =
    input.protocol === "messages"
      ? {
          model: input.model,
          max_tokens: 2048,
          stream: input.stream,
          messages: [{ role: "user", content: input.prompt }],
        }
      : input.protocol === "chat"
        ? {
          model: input.model,
          stream: input.stream,
          stream_options: input.stream ? { include_usage: true } : undefined,
          messages: [{ role: "user", content: input.prompt }],
          }
        : {
            model: input.model,
            stream: input.stream,
            input: input.prompt,
          };
  const response = await fetch("/v0/management/accounts/run", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ account_id: input.accountId, protocol: input.protocol, request: body }),
  });
  if (!response.ok) throw new Error(await errorMessage(response));

  if (!input.stream) {
    input.onChunk(JSON.stringify(await response.json(), null, 2));
    return;
  }
  if (!response.body) throw new Error("The browser did not expose the response stream");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let output = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    output += decoder.decode(value, { stream: true });
    input.onChunk(output);
  }
  output += decoder.decode();
  input.onChunk(output);
}

export function protocolEndpoint(protocol: Protocol): string {
  if (protocol === "messages") return "/v1/messages";
  if (protocol === "chat") return "/v1/chat/completions";
  return "/v1/responses";
}

async function getJson<T>(path: string, apiKey?: string): Promise<T> {
  const response = await fetch(path, {
    headers: apiKey ? { authorization: `Bearer ${apiKey}` } : undefined,
  });
  if (!response.ok) throw new Error(await errorMessage(response));
  return (await response.json()) as T;
}

async function managementJson<T>(
  init: RequestInit & { path?: string },
): Promise<T> {
  const headers = new Headers(init.headers);
  const response = await fetch(`/v0/management/accounts${init.path ?? ""}`, {
    ...init,
    headers,
    credentials: "same-origin",
  });
  if (response.status === 401) throw new UnauthorizedError();
  if (!response.ok) throw new Error(await errorMessage(response));
  return (await response.json()) as T;
}

async function settingsJson<T>(init: RequestInit & { path?: string }): Promise<T> {
  const headers = new Headers(init.headers);
  const response = await fetch(`/v0/management/settings${init.path ?? ""}`, {
    ...init,
    headers,
    credentials: "same-origin",
  });
  if (response.status === 401) throw new UnauthorizedError();
  if (!response.ok) throw new Error(await errorMessage(response));
  return (await response.json()) as T;
}

export async function getSettings(): Promise<RuntimeSettingsView> {
  return (await settingsJson<{ settings: RuntimeSettingsView }>({ method: "GET" })).settings;
}

export async function getSettingsSchema(): Promise<SettingsSchema> {
  return settingsJson<SettingsSchema>({ method: "GET", path: "/schema" });
}

export async function updateSettings(
  patch: Record<string, unknown>,
): Promise<RuntimeSettingsView> {
  const body = await settingsJson<{ settings: RuntimeSettingsView }>({
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  return body.settings;
}

export async function updateManagedAccount(
  id: string,
  changes: { label?: string; disabled?: boolean; priority?: number; note?: string },
): Promise<ManagementAccount> {
  const body = await managementJson<{ account: ManagementAccount }>({
    method: "PUT",
    path: "/update",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, ...changes }),
  });
  return body.account;
}

export async function setManagedAccountProxy(
  id: string,
  proxy: ProxyInput | null,
): Promise<ManagementAccount> {
  const body = await managementJson<{ account: ManagementAccount }>({
    method: "PUT",
    path: "/proxy",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, proxy }),
  });
  return body.account;
}

export async function batchManagedAccounts(input: {
  ids: string[];
  action: "enable" | "disable" | "delete" | "priority";
  priority?: number;
}): Promise<BatchResult[]> {
  const body = await managementJson<{ results: BatchResult[] }>({
    method: "POST",
    path: "/batch",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return body.results;
}

export async function verifyManagedAccount(
  id: string,
): Promise<{ usable: boolean; account: ManagementAccount; detail: AccountPayload }> {
  return managementJson({
    method: "POST",
    path: "/verify",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id }),
  });
}

async function errorMessage(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const body = JSON.parse(text) as {
      error?: { message?: string };
    };
    return body.error?.message || `${response.status} ${response.statusText}`;
  } catch {
    return text || `${response.status} ${response.statusText}`;
  }
}
