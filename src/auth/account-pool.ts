import type { StoredCursorAccount } from "../account/file-store.js";

export class CursorAccountPool {
  private readonly cursors = new Map<string, number>();

  /**
   * Choose the next account for a route.
   *
   * Disabled accounts never participate. Remaining accounts are grouped by
   * priority (lower first) and round-robined within the best group, so a
   * secondary pool is only reached when every preferred account is out.
   */
  pick(accounts: StoredCursorAccount[], routeKey: string): StoredCursorAccount | undefined {
    const eligible = accounts.filter((account) => !account.disabled);
    if (eligible.length === 0) return undefined;
    const best = Math.min(...eligible.map((account) => account.priority));
    const ordered = eligible
      .filter((account) => account.priority === best)
      .sort((left, right) => left.addedAt - right.addedAt || left.id.localeCompare(right.id));
    // Key the cursor by tier so a tier change cannot inherit a stale offset.
    const key = `${routeKey}#${best}`;
    const cursor = this.cursors.get(key) ?? 0;
    const selected = ordered[cursor % ordered.length];
    this.cursors.set(key, (cursor + 1) % ordered.length);
    return selected;
  }

  /** Priority tiers present in the pool, best first. */
  tiers(accounts: StoredCursorAccount[]): number[] {
    return [...new Set(accounts.filter((a) => !a.disabled).map((a) => a.priority))].sort(
      (left, right) => left - right,
    );
  }
}
