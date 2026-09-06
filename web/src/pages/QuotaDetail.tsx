import type { ReactNode } from "react";
import { Meter } from "../bflabs/Meter";
import { formatResetAt } from "../quota";
import { useI18n } from "../state/I18nContext";
import type { AccountPayload } from "../types";

export interface QuotaDetailCopy {
  title: string;
  close: string;
  botChannel: string;
  botAvailable: string;
  botUnavailable: string;
  grokBotPlan: string;
  cursorModels: string;
  otherModels: string;
  autoModels: string;
  totalUsage: string;
  periodSpend: string;
  included: string;
  resetPrefix: string;
  unavailable: string;
  byModel: string;
  byModelPending: string;
}

function num(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function usd(value: number): string {
  return `$${value.toFixed(2)}`;
}

export function QuotaDetail({
  account,
  keyHint,
  onClose,
}: {
  account?: AccountPayload;
  keyHint: string;
  onClose: () => void;
}) {
  const t = useI18n().t.quotaDetail;
  const limits = (account?.limits ?? {}) as Record<string, unknown>;
  const spending = (account?.spending ?? {}) as Record<string, unknown>;
  const grokBot = account?.grok_bot;
  const botAvailable = grokBot?.available === true;

  const planName = str(spending.plan_name);
  const planPrice = str(spending.plan_price);
  const planLabel = [planName, planPrice].filter(Boolean).join(" · ");
  const identity = account?.identity;
  const who = [identity?.first_name, identity?.last_name].filter(Boolean).join(" ");
  const apiKeyName = str(identity?.api_key_name);

  const blockReason = botAvailable ? str(grokBot?.block_reason) : "";
  const botUsed = botAvailable ? num(grokBot?.used_percent) : undefined;
  const botPlan = botAvailable ? str(grokBot?.plan_label) : "";
  const botReset = botAvailable
    ? formatResetAt(grokBot?.next_reset_timestamp_utc, t.resetPrefix)
    : "";

  const cursorPercent = num(limits.cursor_models_percent_used);
  const otherPercent = num(limits.other_models_percent_used);
  const autoPercent = num(limits.auto_models_percent_used);
  const totalPercent = num(limits.used_percent);
  const cycleReset = formatResetAt(limits.billing_cycle_end, t.resetPrefix);

  const totalSpend = num(spending.total_spend_usd);
  const limitUsd = num(limits.limit_usd);

  const meters: ReactNode[] = [];
  if (botUsed !== undefined) {
    meters.push(
      <Meter
        key="bot"
        label={t.grokBotPlan}
        used={botUsed}
        limit={100}
        detail={[botPlan, botReset].filter(Boolean).join(" · ") || undefined}
      />,
    );
  }
  if (cursorPercent !== undefined) {
    meters.push(
      <Meter key="cursor" label={t.cursorModels} used={cursorPercent} limit={100} detail={cycleReset || undefined} />,
    );
  }
  if (otherPercent !== undefined) {
    meters.push(
      <Meter
        key="other"
        label={t.otherModels}
        used={otherPercent}
        limit={100}
        tone={otherPercent >= 100 ? "danger" : "auto"}
        detail={cycleReset || undefined}
      />,
    );
  }
  if (autoPercent !== undefined) {
    meters.push(
      <Meter key="auto" label={t.autoModels} used={autoPercent} limit={100} detail={cycleReset || undefined} />,
    );
  }
  if (totalPercent !== undefined) {
    meters.push(
      <Meter key="total" label={t.totalUsage} used={totalPercent} limit={100} detail={cycleReset || undefined} />,
    );
  }

  return (
    <div className="quota-modal" role="dialog" aria-modal="true" aria-label={`${t.title} ${keyHint}`}>
      <div className="quota-modal__backdrop" onClick={onClose} />
      <div className="quota-modal__panel">
        <header className="quota-modal__head">
          <h2>{t.title} · {keyHint}</h2>
          <button type="button" className="quota-modal__close" onClick={onClose} aria-label={t.close}>
            ×
          </button>
        </header>

        <div className="quota-modal__tags">
          {planLabel ? <span className="quota-tag quota-tag--plan">{planLabel}</span> : null}
          <span className={`quota-tag ${botAvailable ? "quota-tag--bot" : "quota-tag--off"}`}>
            {t.botChannel} {botAvailable ? t.botAvailable : t.botUnavailable}
          </span>
        </div>

        {who || apiKeyName ? (
          <p className="quota-modal__who">{[who, apiKeyName].filter(Boolean).join(" · ")}</p>
        ) : null}

        {blockReason ? <p className="quota-modal__warn">{blockReason}</p> : null}

        {meters.length > 0 ? <div className="quota-modal__meters">{meters}</div> : (
          <p className="quota-modal__empty">{t.unavailable}</p>
        )}

        {totalSpend !== undefined || limitUsd !== undefined ? (
          <p className="quota-modal__spend">
            <strong>{t.periodSpend}</strong>
            {totalSpend !== undefined ? ` ${usd(totalSpend)}` : " —"}
            {limitUsd !== undefined ? ` / ${t.included} ${usd(limitUsd)}` : ""}
          </p>
        ) : null}

        <section className="quota-modal__models">
          <h3>{t.byModel}</h3>
          <p className="quota-modal__empty">{t.byModelPending}</p>
        </section>
      </div>
    </div>
  );
}
