import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addManagedAccount,
  batchManagedAccounts,
  getManagedAccounts,
  onboardManagedAccount,
  probeManagedAccount,
  removeManagedAccount,
  setManagedAccountProxy,
  setManagedDefaultProfile,
  updateManagedAccount,
  verifyManagedAccount,
  type ManagementAccount,
} from "../api";
import { go, readRoute } from "../nav";
import type { RosterItem } from "../roster";
import type { Copy } from "./I18nContext";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed";
}

export interface RosterState {
  roster: RosterItem[];
  activeId: string;
  active?: RosterItem;
  selectedModel: string;
  draftKey: string;
  addError: string;
  adding: boolean;
  profileError: string;
  setActiveId: (id: string) => void;
  setSelectedModel: (value: string) => void;
  setDraftKey: (value: string) => void;
  testAccount: (id: string) => Promise<void>;
  testAll: () => Promise<void>;
  addAccount: () => Promise<void>;
  onboardAccount: (sessionToken: string, grantFable5: boolean, claimSand: boolean) => Promise<void>;
  removeAccount: (id: string) => Promise<void>;
  editAccount: (id: string) => Promise<void>;
  editProxy: (id: string) => Promise<void>;
  moveAccount: (id: string, direction: "up" | "down") => Promise<void>;
  setAccountDisabled: (id: string, disabled: boolean) => Promise<void>;
  verifyAccount: (id: string) => Promise<void>;
  runBatch: (input: {
    ids: string[];
    action: "enable" | "disable" | "delete" | "priority";
    priority?: number;
  }) => Promise<void>;
  setAccountProfile: (id: string, profile: "sdk" | "sand") => Promise<void>;
}

/**
 * Owns the managed-account roster plus the playground selection derived from it
 * (activeId / selectedModel) and every account mutation. This is a straight
 * relocation of the App.tsx logic: same endpoints, same fetch-on-mount, same
 * refresh semantics. `t` is passed in for the prompt/label copy the mutations
 * surface through window.prompt / error strings.
 */
export function useRoster(t: Copy): RosterState {
  const [roster, setRoster] = useState<RosterItem[]>([]);
  const [draftKey, setDraftKey] = useState("");
  const [addError, setAddError] = useState("");
  const [adding, setAdding] = useState(false);
  const [activeId, setActiveId] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [profileError, setProfileError] = useState("");

  const active = useMemo(() => roster.find((item) => item.id === activeId), [roster, activeId]);

  const patchRoster = useCallback((id: string, patch: Partial<RosterItem>) => {
    setRoster((current) => {
      const index = current.findIndex((item) => item.id === id);
      if (index === -1) return current;
      return current.map((item) => (item.id === id ? { ...item, ...patch } : item));
    });
  }, []);

  const probe = useCallback(
    async (id: string) => {
      const started = performance.now();
      patchRoster(id, { testState: "testing", testError: undefined });
      try {
        const { models: nextModels, account: nextAccount } = await probeManagedAccount(id);
        patchRoster(id, {
          testState: "pass",
          testMs: Math.round(performance.now() - started),
          models: nextModels,
          account: nextAccount,
          testError: undefined,
        });
        setSelectedModel((current) => current || nextModels.data[0]?.id || "");
      } catch (error) {
        patchRoster(id, {
          testState: "fail",
          testMs: Math.round(performance.now() - started),
          testError: messageOf(error),
        });
      }
    },
    [patchRoster],
  );

  const loadAccounts = useCallback(async () => {
    try {
      const accounts = await getManagedAccounts();
      const next = accounts.map((account): RosterItem => ({
        id: account.id,
        keyHint: account.key_hint,
        addedAt: account.added_at,
        testState: "idle",
        label: account.label ?? "",
        disabled: account.disabled ?? false,
        priority: account.priority ?? 100,
        note: account.note ?? "",
        proxy: account.proxy,
        lastError: account.last_error ?? null,
      }));
      setRoster(next);
      setActiveId((current) => (next.some((item) => item.id === current) ? current : next[0]?.id ?? ""));
      await Promise.all(next.map((item) => probe(item.id)));
    } catch (error) {
      setAddError(messageOf(error));
      setRoster([]);
    }
  }, [probe]);

  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

  useEffect(() => {
    if (!selectedModel && active?.models?.data[0]?.id) setSelectedModel(active.models.data[0].id);
  }, [active, selectedModel]);

  const applyAccount = useCallback(
    (account: ManagementAccount) => {
      patchRoster(account.id, {
        label: account.label ?? "",
        disabled: account.disabled ?? false,
        priority: account.priority ?? 100,
        note: account.note ?? "",
        proxy: account.proxy,
        lastError: account.last_error ?? null,
      });
    },
    [patchRoster],
  );

  const testAccount = useCallback(
    async (id: string) => {
      const item = roster.find((entry) => entry.id === id);
      if (!item) return;
      await probe(item.id);
    },
    [roster, probe],
  );

  const testAll = useCallback(async () => {
    await Promise.all(roster.map((item) => probe(item.id)));
  }, [roster, probe]);

  const addAccount = useCallback(async () => {
    const key = draftKey.trim();
    if (!key) {
      setAddError(t.keyNeeded);
      return;
    }
    setAdding(true);
    setAddError("");
    try {
      const account = await addManagedAccount(key);
      const next: RosterItem = { id: account.id, keyHint: account.key_hint, addedAt: account.added_at, testState: "testing" };
      setRoster((current) => (current.some((item) => item.id === next.id) ? current : [...current, next]));
      setActiveId(next.id);
      setDraftKey("");
      await probe(next.id);
    } catch (error) {
      setAddError(messageOf(error));
    } finally {
      setAdding(false);
    }
  }, [draftKey, probe, t.keyNeeded]);

  const onboardAccount = useCallback(
    async (sessionToken: string, grantFable5: boolean, claimSand: boolean) => {
      setAdding(true);
      setAddError("");
      try {
        const result = await onboardManagedAccount({ sessionToken, grantFable5, claimSand });
        const account = result.account;
        const next: RosterItem = {
          id: account.id,
          keyHint: account.key_hint,
          addedAt: account.added_at,
          testState: "testing",
        };
        setRoster((current) => (current.some((item) => item.id === next.id) ? current : [...current, next]));
        setActiveId(next.id);
        await probe(next.id);
      } catch (error) {
        setAddError(messageOf(error));
      } finally {
        setAdding(false);
      }
    },
    [probe],
  );

  const removeAccount = useCallback(async (id: string) => {
    try {
      await removeManagedAccount(id);
    } catch (error) {
      setAddError(messageOf(error));
      return;
    }
    setRoster((current) => {
      const next = current.filter((item) => item.id !== id);
      if (id === activeId) {
        setActiveId(next[0]?.id ?? "");
        setSelectedModel("");
      }
      return next;
    });
    if (readRoute().accountId === id) go("accounts");
  }, [activeId]);

  const editAccount = useCallback(
    async (id: string) => {
      const item = roster.find((entry) => entry.id === id);
      const label = window.prompt(t.accountAdmin.labelPrompt, item?.label ?? "");
      if (label == null) return;
      const note = window.prompt(t.accountAdmin.notePrompt, item?.note ?? "");
      if (note == null) return;
      const rawPriority = window.prompt(t.accountAdmin.priorityPrompt, String(item?.priority ?? 100));
      if (rawPriority == null) return;
      const priority = Number.parseInt(rawPriority, 10);
      if (!Number.isInteger(priority)) return;
      setAddError("");
      try {
        applyAccount(await updateManagedAccount(id, { label, note, priority }));
      } catch (error) {
        setAddError(messageOf(error));
      }
    },
    [roster, t.accountAdmin, applyAccount],
  );

  const editProxy = useCallback(
    async (id: string) => {
      const item = roster.find((entry) => entry.id === id);
      const current = item?.proxy?.configured ? `${item.proxy.scheme}://${item.proxy.host}` : "";
      const url = window.prompt(t.accountAdmin.proxyPrompt, current);
      if (url == null) return;
      setAddError("");
      try {
        if (!url.trim()) {
          applyAccount(await setManagedAccountProxy(id, null));
          return;
        }
        const username = window.prompt(t.settings.proxyUser, "") ?? "";
        const password = window.prompt(t.settings.proxyPassword, "") ?? "";
        applyAccount(
          await setManagedAccountProxy(id, {
            url: url.trim(),
            ...(username ? { username } : {}),
            ...(password ? { password } : {}),
          }),
        );
      } catch (error) {
        setAddError(messageOf(error));
      }
    },
    [roster, t.accountAdmin, t.settings, applyAccount],
  );

  const moveAccount = useCallback(
    async (id: string, direction: "up" | "down") => {
      // The table is ordered by priority, so swapping with the neighbour's
      // priority is what "move up/down" means. Equal priorities are spread first
      // so a swap has something to exchange.
      const ordered = [...roster].sort(
        (left, right) => (left.priority ?? 100) - (right.priority ?? 100) || left.addedAt - right.addedAt,
      );
      const index = ordered.findIndex((item) => item.id === id);
      const target = direction === "up" ? index - 1 : index + 1;
      if (index < 0 || target < 0 || target >= ordered.length) return;
      setAddError("");
      try {
        const self = ordered[index]!;
        const other = ordered[target]!;
        const selfPriority = self.priority ?? 100;
        const otherPriority = other.priority ?? 100;
        if (selfPriority === otherPriority) {
          // Same tier: nudge this row past the neighbour instead of a no-op swap.
          const shifted = direction === "up" ? selfPriority - 1 : selfPriority + 1;
          const clamped = Math.min(1000, Math.max(0, shifted));
          applyAccount(await updateManagedAccount(id, { priority: clamped }));
          return;
        }
        const [first, second] = await Promise.all([
          updateManagedAccount(self.id, { priority: otherPriority }),
          updateManagedAccount(other.id, { priority: selfPriority }),
        ]);
        applyAccount(first);
        applyAccount(second);
      } catch (error) {
        setAddError(messageOf(error));
      }
    },
    [roster, applyAccount],
  );

  const setAccountDisabled = useCallback(
    async (id: string, disabled: boolean) => {
      setAddError("");
      try {
        applyAccount(await updateManagedAccount(id, { disabled }));
      } catch (error) {
        setAddError(messageOf(error));
      }
    },
    [applyAccount],
  );

  const verifyAccount = useCallback(
    async (id: string) => {
      setAddError("");
      patchRoster(id, { testState: "testing" });
      try {
        const result = await verifyManagedAccount(id);
        applyAccount(result.account);
        patchRoster(id, {
          account: result.detail,
          testState: result.usable ? "pass" : "fail",
          testError: result.usable ? undefined : result.account.last_error?.reason,
        });
      } catch (error) {
        patchRoster(id, { testState: "fail", testError: messageOf(error) });
      }
    },
    [patchRoster, applyAccount],
  );

  const runBatch = useCallback(
    async (input: { ids: string[]; action: "enable" | "disable" | "delete" | "priority"; priority?: number }) => {
      setAddError("");
      try {
        const results = await batchManagedAccounts(input);
        const failures = results.filter((result) => !result.ok);
        if (failures.length > 0) {
          setAddError(`${failures.length} / ${results.length} failed`);
        }
        // The batch may have deleted or changed many rows; refetch for truth.
        await loadAccounts();
      } catch (error) {
        setAddError(messageOf(error));
      }
    },
    [loadAccounts],
  );

  const setAccountProfile = useCallback(
    async (id: string, profile: "sdk" | "sand") => {
      setProfileError("");
      try {
        const account = await setManagedDefaultProfile(id, profile);
        patchRoster(id, { account });
      } catch (error) {
        setProfileError(messageOf(error) || t.detail.profileError);
      }
    },
    [patchRoster, t.detail.profileError],
  );

  return {
    roster,
    activeId,
    active,
    selectedModel,
    draftKey,
    addError,
    adding,
    profileError,
    setActiveId,
    setSelectedModel,
    setDraftKey,
    testAccount,
    testAll,
    addAccount,
    onboardAccount,
    removeAccount,
    editAccount,
    editProxy,
    moveAccount,
    setAccountDisabled,
    verifyAccount,
    runBatch,
    setAccountProfile,
  };
}
