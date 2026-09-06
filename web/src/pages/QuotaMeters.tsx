import { Meter } from "../bflabs/Meter";
import {
  cursorUsedPercent,
  formatPercent,
  formatQuota,
  formatQuotaBreakdown,
  formatResetAt,
  grokBotRemainingPercent,
  grokBotUsedPercent,
} from "../quota";
import type { AccountPayload } from "../types";

export function QuotaPair({
  account,
  cursorLabel,
  grokLabel,
  cursorMissing,
  grokMissing,
  remainingPrefix,
  resetPrefix,
}: {
  account?: AccountPayload;
  cursorLabel: string;
  grokLabel: string;
  cursorMissing: string;
  grokMissing: string;
  remainingPrefix: string;
  resetPrefix: string;
}) {
  const cursorUsed = cursorUsedPercent(account);
  const grokUsed = grokBotUsedPercent(account);
  const grokRemaining = grokBotRemainingPercent(account);
  const cursorDetail = [formatQuota(account), formatQuotaBreakdown(account)].filter(Boolean).join(" · ");
  const plan = typeof account?.grok_bot?.plan_label === "string" ? account.grok_bot.plan_label.trim() : "";
  const grokDetail = [
    grokRemaining !== undefined ? remainingPrefix.replace("{n}", formatPercent(grokRemaining)) : "",
    plan,
    formatResetAt(account?.grok_bot?.next_reset_timestamp_utc, resetPrefix),
  ].filter(Boolean).join(" · ");

  return (
    <div className="quota-pair">
      <div className="quota-meter">
        <Meter
          label={cursorLabel}
          used={cursorUsed ?? 0}
          limit={cursorUsed !== undefined ? 100 : 0}
          detail={cursorDetail || cursorMissing}
        />
      </div>
      <div className="quota-meter">
        <Meter
          label={grokLabel}
          used={grokUsed ?? 0}
          limit={grokUsed !== undefined ? 100 : 0}
          detail={grokDetail || grokMissing}
        />
      </div>
    </div>
  );
}
