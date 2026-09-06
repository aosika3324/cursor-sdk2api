import { useMemo, useState } from "react";
import { Button } from "../bflabs/Button";
import { Checkbox } from "../bflabs/Checkbox";
import { Field } from "../bflabs/Field";
import { Input } from "../bflabs/Input";
import { Modal } from "../bflabs/Modal";
import type { RosterItem } from "../roster";
import { useI18n } from "../state/I18nContext";
import { AccountTable } from "./AccountTable";
import { ConfirmDialog } from "./ConfirmDialog";
import type { HomeCopy } from "./HomePage";
import { ActionLink, PageFrame } from "./shared";

export interface AccountAdminCopy {
  edit: string;
  proxy: string;
  verify: string;
  enable: string;
  disable: string;
  disabledTag: string;
  priority: string;
  proxyDirect: string;
  selected: string;
  batchEnable: string;
  batchDisable: string;
  batchDelete: string;
  batchPriority: string;
  batchConfirmDelete: string;
  clearSelection: string;
  proxyClearHint: string;
  quota: string;
  moveUp: string;
  moveDown: string;
  available: string;
  botWithQuota: string;
  botFull: string;
  botOff: string;
  planPercent: string;
  badgeFableOn: string;
  badgeFableOff: string;
  importKey: string;
  importToken: string;
  tokenPlaceholder: string;
  tokenHelp: string;
  grantFable5: string;
  claimSand: string;
  onboarding: string;
}

export function AccountsPage({
  draftKey,
  addError,
  adding,
  roster,
  onDraft,
  onAdd,
  onTest,
  onRemove,
  onEdit,
  onProxy,
  onVerify,
  onDisable,
  onBatch,
  onMove,
  onQuota,
  onOnboard,
  onboarding,
}: {
  draftKey: string;
  addError: string;
  adding: boolean;
  roster: RosterItem[];
  onDraft: (value: string) => void;
  onAdd: () => void;
  onTest: (id: string) => void;
  onRemove: (id: string) => void;
  onEdit: (id: string) => void;
  onProxy: (id: string) => void;
  onVerify: (id: string) => void;
  onDisable: (id: string, disabled: boolean) => void;
  onBatch: (input: {
    ids: string[];
    action: "enable" | "disable" | "delete" | "priority";
    priority?: number;
  }) => void;
  onMove: (id: string, direction: "up" | "down") => void;
  onQuota: (id: string) => void;
  onOnboard: (sessionToken: string, grantFable5: boolean, claimSand: boolean) => void;
  onboarding: boolean;
}) {
  const copy = useI18n().t;
  const t = copy.home as unknown as HomeCopy & { add: string; adding: string; keyPlaceholder: string; keyHelp: string; remove: string };
  const admin = copy.accountAdmin;
  const passed = roster.filter((item) => item.testState === "pass").length;
  const failed = roster.filter((item) => item.testState === "fail").length;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<"key" | "token">("key");
  const [tokenDraft, setTokenDraft] = useState("");
  const [grantF5, setGrantF5] = useState(true);
  const [claimBot, setClaimBot] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [priorityOpen, setPriorityOpen] = useState(false);
  const [priorityDraft, setPriorityDraft] = useState("100");

  // Drop ids that no longer exist so a stale selection cannot act on them.
  const liveSelection = useMemo(
    () => new Set([...selected].filter((id) => roster.some((item) => item.id === id))),
    [selected, roster],
  );

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected((prev) =>
      prev.size === roster.length ? new Set() : new Set(roster.map((item) => item.id)),
    );
  };

  const runBatch = (action: "enable" | "disable" | "delete" | "priority") => {
    const ids = [...liveSelection];
    if (ids.length === 0) return;
    if (action === "delete") {
      setConfirmDelete(true);
      return;
    }
    if (action === "priority") {
      setPriorityDraft("100");
      setPriorityOpen(true);
      return;
    }
    onBatch({ ids, action });
    setSelected(new Set());
  };

  const confirmBatchDelete = () => {
    const ids = [...liveSelection];
    if (ids.length === 0) return;
    onBatch({ ids, action: "delete" });
    setSelected(new Set());
  };

  const confirmBatchPriority = () => {
    const ids = [...liveSelection];
    const priority = Number.parseInt(priorityDraft, 10);
    if (ids.length === 0 || !Number.isInteger(priority)) return;
    onBatch({ ids, action: "priority", priority });
    setSelected(new Set());
    setPriorityOpen(false);
  };

  return (
    <PageFrame
      kicker={t.manage}
      title={t.authTitle}
      actions={<ActionLink href="#/">{t.dashTitle}</ActionLink>}
    >
      <p className="page-meta">{t.authMeta
        .replace("{total}", String(roster.length))
        .replace("{ok}", String(passed))
        .replace("{bad}", String(failed))}</p>
      <div className="import-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "key"}
          className={mode === "key" ? "is-active" : ""}
          onClick={() => setMode("key")}
        >
          {admin.importKey}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "token"}
          className={mode === "token" ? "is-active" : ""}
          onClick={() => setMode("token")}
        >
          {admin.importToken}
        </button>
      </div>
      {mode === "key" ? (
        <form
          className="add-row page-add"
          onSubmit={(event) => {
            event.preventDefault();
            onAdd();
          }}
        >
          <Input
            type="password"
            value={draftKey}
            autoComplete="off"
            spellCheck={false}
            placeholder={t.keyPlaceholder}
            onChange={(event) => onDraft(event.target.value)}
          />
          <Button type="submit" variant="primary" size="sm" loading={adding} disabled={adding}>
            {adding ? t.adding : t.add}
          </Button>
        </form>
      ) : (
        <form
          className="add-row page-add"
          onSubmit={(event) => {
            event.preventDefault();
            if (!tokenDraft.trim()) return;
            onOnboard(tokenDraft.trim(), grantF5, claimBot);
            setTokenDraft("");
          }}
        >
          <Input
            type="password"
            value={tokenDraft}
            autoComplete="off"
            spellCheck={false}
            placeholder={admin.tokenPlaceholder}
            onChange={(event) => setTokenDraft(event.target.value)}
          />
          <Checkbox
            className="inline-check"
            label={admin.grantFable5}
            checked={grantF5}
            onChange={(event) => setGrantF5(event.target.checked)}
          />
          <Checkbox
            className="inline-check"
            label={admin.claimSand}
            checked={claimBot}
            onChange={(event) => setClaimBot(event.target.checked)}
          />
          <Button type="submit" variant="primary" size="sm" loading={onboarding} disabled={onboarding}>
            {onboarding ? admin.onboarding : t.add}
          </Button>
        </form>
      )}
      {addError ? <p className="field-error" role="alert">{addError}</p> : null}
      <p className="note">{mode === "key" ? t.keyHelp : admin.tokenHelp}</p>
      {liveSelection.size > 0 ? (
        <div className="batch-bar" role="group">
          <span>{admin.selected.replace("{n}", String(liveSelection.size))}</span>
          <Button variant="secondary" size="sm" onClick={() => runBatch("enable")}>{admin.batchEnable}</Button>
          <Button variant="secondary" size="sm" onClick={() => runBatch("disable")}>{admin.batchDisable}</Button>
          <Button variant="secondary" size="sm" onClick={() => runBatch("priority")}>{admin.batchPriority}</Button>
          <Button variant="quiet" size="sm" onClick={() => runBatch("delete")}>{admin.batchDelete}</Button>
          <Button variant="quiet" size="sm" onClick={() => setSelected(new Set())}>{admin.clearSelection}</Button>
        </div>
      ) : null}
      {roster.length === 0 ? <p className="empty">{t.noAccounts}</p> : (
        <AccountTable
          items={roster}
          quotaMissing={t.quotaMissing}
          grokBotQuota={t.grokBotQuota}
          grokBotMissing={t.grokBotMissing}
          fableOn={t.fableOn}
          fableOff={t.fableOff}
          fableUnknown={t.fableUnknown}
          testing={t.testing}
          test={t.test}
          testFail={t.testFail}
          open={t.open}
          remove={t.remove}
          headers={t.headers}
          onTest={onTest}
          onRemove={onRemove}
          extras={{
            selected: liveSelection,
            onToggle: toggle,
            onToggleAll: toggleAll,
            onEdit,
            onProxy,
            onVerify,
            onDisable,
            onMove,
            onQuota,
            labels: {
              edit: admin.edit,
              proxy: admin.proxy,
              verify: admin.verify,
              enable: admin.enable,
              disable: admin.disable,
              disabledTag: admin.disabledTag,
              priority: admin.priority,
              proxyDirect: admin.proxyDirect,
              quota: admin.quota,
              moveUp: admin.moveUp,
              moveDown: admin.moveDown,
              available: admin.available,
              badges: {
                botWithQuota: admin.botWithQuota,
                botFull: admin.botFull,
                botOff: admin.botOff,
                planPercent: admin.planPercent,
                fableOn: admin.badgeFableOn,
                fableOff: admin.badgeFableOff,
              },
            },
          }}
        />
      )}
      <ConfirmDialog
        open={confirmDelete}
        title={copy.editModal.confirmRemoveTitle}
        body={admin.batchConfirmDelete.replace("{n}", String(liveSelection.size))}
        confirmLabel={admin.batchDelete}
        onConfirm={confirmBatchDelete}
        onClose={() => setConfirmDelete(false)}
      />
      <Modal
        open={priorityOpen}
        onClose={() => setPriorityOpen(false)}
        title={admin.batchPriority}
        footer={
          <>
            <Button variant="quiet" size="sm" onClick={() => setPriorityOpen(false)}>
              {copy.editModal.cancel}
            </Button>
            <Button variant="primary" size="sm" onClick={confirmBatchPriority}>
              {copy.editModal.save}
            </Button>
          </>
        }
      >
        <Field label={admin.priority} hint={copy.editModal.priorityHint}>
          <Input
            type="number"
            value={priorityDraft}
            onChange={(event) => setPriorityDraft(event.target.value)}
          />
        </Field>
      </Modal>
    </PageFrame>
  );
}
