import { Button } from "../bflabs/Button";
import { Card } from "../bflabs/Card";
import { Checkbox } from "../bflabs/Checkbox";
import { Input } from "../bflabs/Input";
import { Notice } from "../bflabs/Notice";
import { Select } from "../bflabs/Select";
import { PageFrame } from "./shared";
import { useI18n } from "../state/I18nContext";
import { useSettings } from "../state/useSettings";
import { type SettingsEffect } from "../api";

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

export function SettingsPage() {
  const t = useI18n().t.settings;
  const {
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
  } = useSettings();

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
                    <Checkbox
                      checked={Boolean(value(field.key))}
                      onChange={(event) =>
                        setDraft((prev) => ({ ...prev, [field.key]: event.target.checked }))
                      }
                    />
                  ) : field.type === "enum" ? (
                    <Select
                      value={String(value(field.key) ?? "")}
                      onChange={(event) =>
                        setDraft((prev) => ({ ...prev, [field.key]: event.target.value }))
                      }
                    >
                      {(field.values ?? []).map((option) => (
                        <option key={option} value={option}>{option}</option>
                      ))}
                    </Select>
                  ) : (
                    <Input
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
            <Input
              type="text"
              placeholder="socks5://127.0.0.1:1080"
              value={proxyDraft.url}
              onChange={(event) => setProxyDraft((prev) => ({ ...prev, url: event.target.value }))}
            />
          </label>
          <label className="settings-row">
            <span className="settings-row__key">{t.proxyUser}</span>
            <Input
              type="text"
              value={proxyDraft.username}
              onChange={(event) =>
                setProxyDraft((prev) => ({ ...prev, username: event.target.value }))
              }
            />
          </label>
          <label className="settings-row">
            <span className="settings-row__key">{t.proxyPassword}</span>
            <Input
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
