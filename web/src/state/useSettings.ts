import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getSettings,
  getSettingsSchema,
  updateSettings,
  type RuntimeSettingsView,
  type SettingsSchema,
} from "../api";

export interface SettingsState {
  schema: SettingsSchema | null;
  settings: RuntimeSettingsView | null;
  draft: Record<string, unknown>;
  proxyDraft: { url: string; username: string; password: string };
  status: "idle" | "saving" | "saved";
  error: string | null;
  dirty: boolean;
  setDraft: React.Dispatch<React.SetStateAction<Record<string, unknown>>>;
  setProxyDraft: React.Dispatch<React.SetStateAction<{ url: string; username: string; password: string }>>;
  load: () => Promise<void>;
  save: () => Promise<void>;
  clearProxy: () => Promise<void>;
}

/**
 * Owns runtime-settings fetch/save. This is a direct relocation of the logic
 * that lived inside SettingsPage — same endpoints (getSettingsSchema,
 * getSettings, updateSettings), same fetch-on-mount, same save/clear behavior.
 */
export function useSettings(): SettingsState {
  const [schema, setSchema] = useState<SettingsSchema | null>(null);
  const [settings, setSettings] = useState<RuntimeSettingsView | null>(null);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [proxyDraft, setProxyDraft] = useState({ url: "", username: "", password: "" });
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [nextSchema, nextSettings] = await Promise.all([getSettingsSchema(), getSettings()]);
      setSchema(nextSchema);
      setSettings(nextSettings);
      setDraft({});
      setProxyDraft({ url: "", username: "", password: "" });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = useMemo(
    () => Object.keys(draft).length > 0 || proxyDraft.url.trim() !== "",
    [draft, proxyDraft.url],
  );

  const save = useCallback(async () => {
    setStatus("saving");
    setError(null);
    const patch: Record<string, unknown> = { ...draft };
    if (proxyDraft.url.trim()) {
      patch.globalProxy = {
        url: proxyDraft.url.trim(),
        ...(proxyDraft.username ? { username: proxyDraft.username } : {}),
        ...(proxyDraft.password ? { password: proxyDraft.password } : {}),
      };
    }
    try {
      const next = await updateSettings(patch);
      setSettings(next);
      setDraft({});
      setProxyDraft({ url: "", username: "", password: "" });
      setStatus("saved");
      window.setTimeout(() => setStatus("idle"), 2000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setStatus("idle");
    }
  }, [draft, proxyDraft]);

  const clearProxy = useCallback(async () => {
    setError(null);
    try {
      setSettings(await updateSettings({ globalProxy: null }));
      setProxyDraft({ url: "", username: "", password: "" });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  return {
    schema,
    settings,
    draft,
    proxyDraft,
    status,
    error,
    dirty,
    setDraft,
    setProxyDraft,
    load,
    save,
    clearProxy,
  };
}
