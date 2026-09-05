import { useMemo, useState } from "react";
import { Button } from "../bflabs/Button";
import type { RosterItem } from "../roster";
import { AccountTable } from "./AccountTable";
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
  labelPrompt: string;
  notePrompt: string;
  priorityPrompt: string;
  proxyPrompt: string;
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
}

export function AccountsPage({
  t,
  admin,
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
}: {
  t: HomeCopy & { add: string; adding: string; keyPlaceholder: string; keyHelp: string; remove: string };
  admin: AccountAdminCopy;
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
}) {
  const passed = roster.filter((item) => item.testState === "pass").length;
  const failed = roster.filter((item) => item.testState === "fail").length;
  const [selected, setSelected] = useState<Set<string>>(new Set());

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
    if (action === "delete" && !window.confirm(admin.batchConfirmDelete.replace("{n}", String(ids.length)))) {
      return;
    }
    if (action === "priority") {
      const raw = window.prompt(admin.priorityPrompt, "100");
      if (raw == null) return;
      const priority = Number.parseInt(raw, 10);
      if (!Number.isInteger(priority)) return;
      onBatch({ ids, action, priority });
    } else {
      onBatch({ ids, action });
    }
    setSelected(new Set());
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
      <form
        className="add-row page-add"
        onSubmit={(event) => {
          event.preventDefault();
          onAdd();
        }}
      >
        <input
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
      {addError ? <p className="field-error" role="alert">{addError}</p> : null}
      <p className="note">{t.keyHelp}</p>
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
    </PageFrame>
  );
}
