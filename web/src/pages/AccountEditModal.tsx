import { useEffect, useState } from "react";
import type { ProxyInput } from "../api";
import { Button } from "../bflabs/Button";
import { Field } from "../bflabs/Field";
import { Input } from "../bflabs/Input";
import { Modal } from "../bflabs/Modal";
import { Notice } from "../bflabs/Notice";
import { Select } from "../bflabs/Select";
import { Switch } from "../bflabs/Switch";
import { Textarea } from "../bflabs/Textarea";
import { currentProfile } from "../quota";
import type { RosterItem } from "../roster";
import { useI18n } from "../state/I18nContext";

export type AccountEdits = { label: string; note: string; priority: number; disabled: boolean };

export function AccountEditModal({
  open,
  item,
  sandCapable,
  onClose,
  onSaveAccount,
  onSaveProxy,
  onSaveProfile,
}: {
  open: boolean;
  item?: RosterItem;
  sandCapable: boolean;
  onClose: () => void;
  onSaveAccount: (id: string, edits: AccountEdits) => Promise<boolean>;
  onSaveProxy: (id: string, proxy: ProxyInput | null) => Promise<boolean>;
  onSaveProfile: (id: string, profile: "sdk" | "sand") => Promise<boolean>;
}) {
  const t = useI18n().t.editModal;
  const [label, setLabel] = useState("");
  const [note, setNote] = useState("");
  const [priority, setPriority] = useState("100");
  const [disabled, setDisabled] = useState(false);
  const [profile, setProfile] = useState<"sdk" | "sand">("sdk");
  const [proxyUrl, setProxyUrl] = useState("");
  const [proxyUser, setProxyUser] = useState("");
  const [proxyPassword, setProxyPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  // Snapshot of the proxy URL as loaded, so we only touch the proxy endpoint
  // when the operator actually changed something.
  const initialProxyUrl =
    item?.proxy?.configured && item.proxy.scheme && item.proxy.host
      ? `${item.proxy.scheme}://${item.proxy.host}`
      : "";

  useEffect(() => {
    if (!open || !item) return;
    setLabel(item.label ?? "");
    setNote(item.note ?? "");
    setPriority(String(item.priority ?? 100));
    setDisabled(item.disabled ?? false);
    setProfile(currentProfile(item.account));
    setProxyUrl(initialProxyUrl);
    setProxyUser("");
    setProxyPassword("");
    setSaving(false);
    setError(false);
    // initialProxyUrl derives from item; item is the real dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item]);

  if (!item) return null;

  // Never dismiss (Escape/backdrop/X or Cancel) mid-save.
  const guardedClose = () => {
    if (!saving) onClose();
  };

  const save = async () => {
    const parsedPriority = Number.parseInt(priority, 10);
    const nextPriority = Number.isInteger(parsedPriority) ? parsedPriority : (item.priority ?? 100);
    setSaving(true);
    setError(false);
    try {
      let ok = await onSaveAccount(item.id, { label, note, priority: nextPriority, disabled });

      const trimmedUrl = proxyUrl.trim();
      const proxyTouched =
        trimmedUrl !== initialProxyUrl || proxyUser.trim() !== "" || proxyPassword !== "";
      if (ok && proxyTouched) {
        if (!trimmedUrl) {
          ok = await onSaveProxy(item.id, null);
        } else {
          ok = await onSaveProxy(item.id, {
            url: trimmedUrl,
            ...(proxyUser.trim() ? { username: proxyUser.trim() } : {}),
            ...(proxyPassword ? { password: proxyPassword } : {}),
          });
        }
      }

      if (ok && profile !== currentProfile(item.account)) {
        ok = await onSaveProfile(item.id, profile);
      }

      if (ok) {
        onClose();
      } else {
        setError(true);
      }
    } finally {
      setSaving(false);
    }
  };

  const credsSet = Boolean(item.proxy?.has_username || item.proxy?.has_password);

  return (
    <Modal
      open={open}
      onClose={guardedClose}
      dismissible={!saving}
      title={t.title}
      footer={
        <>
          <Button variant="quiet" size="sm" onClick={guardedClose} disabled={saving}>
            {t.cancel}
          </Button>
          <Button
            variant="primary"
            size="sm"
            loading={saving}
            disabled={saving}
            onClick={() => void save()}
          >
            {saving ? t.saving : t.save}
          </Button>
        </>
      }
    >
      <div className="bf-form-stack">
        {error ? (
          <Notice className="bf-notice--danger" role="alert" icon={null} title={t.saveError} />
        ) : null}
        <Field label={t.label}>
          <Input value={label} onChange={(event) => setLabel(event.target.value)} />
        </Field>
        <Field label={t.note}>
          <Textarea value={note} onChange={(event) => setNote(event.target.value)} />
        </Field>
        <Field label={t.priority} hint={t.priorityHint}>
          <Input
            type="number"
            value={priority}
            onChange={(event) => setPriority(event.target.value)}
          />
        </Field>
        <Field label={t.disabled}>
          <Switch checked={disabled} onChange={(event) => setDisabled(event.target.checked)} />
        </Field>
        <Field label={t.profile} hint={!sandCapable ? t.profileSandOff : undefined}>
          <Select
            value={profile}
            onChange={(event) => setProfile(event.target.value === "sand" ? "sand" : "sdk")}
          >
            <option value="sdk">{t.profileSdk}</option>
            <option value="sand" disabled={!sandCapable && profile !== "sand"}>
              {t.profileSand}
            </option>
          </Select>
        </Field>
        <h3 className="bf-form-heading">{t.proxyHeading}</h3>
        <Field label={t.proxyUrl} hint={t.proxyUrlHint}>
          <Input value={proxyUrl} onChange={(event) => setProxyUrl(event.target.value)} />
        </Field>
        <Field label={t.proxyUser} hint={credsSet ? t.proxyCredsSet : undefined}>
          <Input
            value={proxyUser}
            placeholder={item.proxy?.has_username ? "••••••" : undefined}
            onChange={(event) => setProxyUser(event.target.value)}
          />
        </Field>
        <Field label={t.proxyPassword} hint={credsSet ? t.proxyCredsSet : t.proxySecretHint}>
          <Input
            type="password"
            value={proxyPassword}
            placeholder={item.proxy?.has_password ? "••••••" : undefined}
            onChange={(event) => setProxyPassword(event.target.value)}
          />
        </Field>
      </div>
    </Modal>
  );
}
