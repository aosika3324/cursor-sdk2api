import { useEffect, useMemo, useState } from "react";
import { Button } from "../bflabs/Button";
import { Card } from "../bflabs/Card";
import { Notice } from "../bflabs/Notice";
import { PageFrame } from "./shared";
import {
  getSettings,
  getSettingsSchema,
  updateSettings,
  type RuntimeSettingsView,
  type SettingsEffect,
  type SettingsSchema,
} from "../api";

export interface SettingsCopy {
  title: string;
  kicker: string;
  hot: string;
  hotHint: string;
  newSessions: string;
  newSessionsHint: string;
  restart: string;
  restartHint: string;
  save: string;
  saving: string;
  saved: string;
  reload: string;
  seeded: string;
  proxyUrl: string;
  proxyUser: string;
  proxyPassword: string;
  proxyClear: string;
  proxyConfigured: string;
  proxyNone: string;
  proxySecretHidden: string;
}

const GROUPS: Array<{ effect: SettingsEffect }> = [
  { effect: "hot" },
  { effect: "new_sessions" },
];

export function SettingsPage({ t }: { t: SettingsCopy }) {
  const [schema, setSchema] = useState<SettingsSchema | null>(null);
  const [settings, setSettings] = useState<RuntimeSettingsView | null>(null);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [proxyDraft, setProxyDraft] = useState({ url: "", username: "", password: "" });
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
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
  };

  useEffect(() => {
    void load();
  }, []);

  const dirty = useMemo(
    () => Object.keys(draft).length > 0 || proxyDraft.url.trim() !== "",
    [draft, proxyDraft.url],
  );

  const save = async () => {
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
  };

  const clearProxy = async () => {
    setError(null);
    try {
      setSettings(await updateSettings({ globalProxy: null }));
      setProxyDraft({ url: "", username: "", password: "" });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  if (!schema || !settings) {
    return (
      <PageFrame title={t.title} kicker={t.kicker}>
        {error ? <Notice title={error} /> : null}
      </PageFrame>
    );
  }

  const value = (key: string): unknown =>
    key in draft ? draft[key] : (settings as unknown as Record<string, unknown>)[key];

  return (
    <PageFrame
      title={t.title}
      kicker={t.kicker}
      actions={
        <>
          <Button variant="quiet" onClick={() => void load()}>{t.reload}</Button>
          <Button onClick={() => void save()} disabled={!dirty || status === "saving"}>
            {status === "saving" ? t.saving : status === "saved" ? t.saved : t.save}
          </Button>
        </>
      }
    >
      {error ? <Notice title={error} /> : null}
      {schema.seeded_from_env ? <Notice title={t.seeded} /> : null}

      {GROUPS.map((group) => {
        const fields = schema.fields.filter(
          (field) => field.effect === group.effect && field.type !== "proxy",
        );
        if (fields.length === 0) return null;
        const label = group.effect === "hot" ? t.hot : t.newSessions;
        const hint = group.effect === "hot" ? t.hotHint : t.newSessionsHint;
        return (
          <Card key={group.effect} title={label} description={hint}>
            <div className="settings-grid">
              {fields.map((field) => (
                <label key={field.key} className="settings-row">
                  <span className="settings-row__key">{field.key}</span>
                  {field.type === "boolean" ? (
                    <input
                      type="checkbox"
                      checked={Boolean(value(field.key))}
                      onChange={(event) =>
                        setDraft((prev) => ({ ...prev, [field.key]: event.target.checked }))
                      }
                    />
                  ) : field.type === "enum" ? (
                    <select
                      value={String(value(field.key) ?? "")}
                      onChange={(event) =>
                        setDraft((prev) => ({ ...prev, [field.key]: event.target.value }))
                      }
                    >
                      {(field.values ?? []).map((option) => (
                        <option key={option} value={option}>{option}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="number"
                      value={Number(value(field.key) ?? 0)}
                      min={field.min}
                      max={field.max}
                      onChange={(event) =>
                        setDraft((prev) => ({
                          ...prev,
                          [field.key]: Number.parseInt(event.target.value, 10),
                        }))
                      }
                    />
                  )}
                </label>
              ))}
            </div>
          </Card>
        );
      })}

      <Card title="globalProxy" description={t.newSessionsHint}>
        <p className="settings-note">
          {settings.globalProxy.configured
            ? `${t.proxyConfigured}: ${settings.globalProxy.scheme}://${settings.globalProxy.host}`
            : t.proxyNone}
        </p>
        <p className="settings-note settings-note--muted">{t.proxySecretHidden}</p>
        <div className="settings-grid">
          <label className="settings-row">
            <span className="settings-row__key">{t.proxyUrl}</span>
            <input
              type="text"
              placeholder="socks5://127.0.0.1:1080"
              value={proxyDraft.url}
              onChange={(event) => setProxyDraft((prev) => ({ ...prev, url: event.target.value }))}
            />
          </label>
          <label className="settings-row">
            <span className="settings-row__key">{t.proxyUser}</span>
            <input
              type="text"
              value={proxyDraft.username}
              onChange={(event) =>
                setProxyDraft((prev) => ({ ...prev, username: event.target.value }))
              }
            />
          </label>
          <label className="settings-row">
            <span className="settings-row__key">{t.proxyPassword}</span>
            <input
              type="password"
              value={proxyDraft.password}
              onChange={(event) =>
                setProxyDraft((prev) => ({ ...prev, password: event.target.value }))
              }
            />
          </label>
        </div>
        {settings.globalProxy.configured ? (
          <Button variant="quiet" onClick={() => void clearProxy()}>{t.proxyClear}</Button>
        ) : null}
      </Card>

      <Card title={t.restart} description={t.restartHint}>
        <div className="settings-grid">
          {Object.entries(schema.restart_only).map(([key, restartValue]) => (
            <div key={key} className="settings-row">
              <span className="settings-row__key">{key}</span>
              <span className="settings-row__readonly">{String(restartValue)}</span>
            </div>
          ))}
        </div>
      </Card>
    </PageFrame>
  );
}
