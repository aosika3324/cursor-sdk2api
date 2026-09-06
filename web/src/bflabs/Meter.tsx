import type { ReactNode } from "react";
import { CountUp } from "./CountUp";
import { formatPercent } from "../quota";

export type MeterTone = "auto" | "default" | "warn" | "danger";

function num(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

/** Clamp a raw used/limit pair to a 0-100 percentage. limit<=0 → 0%. */
function usedPercentOf(used: number, limit: number): number {
  const u = num(used);
  const l = num(limit);
  if (l <= 0) return 0;
  return Math.min(100, Math.max(0, (u / l) * 100));
}

/** auto tone from pressure: <70 default, 70-90 warn, >90 danger. */
function toneFor(tone: MeterTone, percent: number): "default" | "warn" | "danger" {
  if (tone !== "auto") return tone;
  if (percent > 90) return "danger";
  if (percent >= 70) return "warn";
  return "default";
}

/** "resets in Xh Ym" from an epoch-ms target. Returns "" when past/absent. */
function resetCountdown(resetAt: number): string {
  const ms = resetAt - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const totalMinutes = Math.floor(ms / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  return `${hours}h ${minutes}m`;
}

/**
 * One labeled quota meter. Tone conveys pressure, never color alone: the
 * numeric value and percent are ALWAYS printed. role=progressbar with the
 * usual aria-value* attributes; tone lands on a data-tone attribute so the
 * CSS can shade the fill with tokens only.
 */
export function Meter({
  label,
  used,
  limit,
  unit,
  tone = "auto",
  resetAt,
  detail,
}: {
  label: ReactNode;
  used: number;
  limit: number;
  unit?: string;
  tone?: MeterTone;
  resetAt?: number;
  detail?: ReactNode;
}) {
  const percent = usedPercentOf(used, limit);
  const rounded = Math.round(percent);
  const resolved = toneFor(tone, percent);
  const ariaLabel = typeof label === "string" ? label : undefined;
  const countdown = resetAt !== undefined ? resetCountdown(resetAt) : "";
  const valueText = `${num(used)} / ${num(limit)}${unit ? ` ${unit}` : ""}`;

  return (
    <div className="bf-meter" data-tone={resolved}>
      <div className="bf-meter__meta">
        <span className="bf-meter__label">{label}</span>
        <span className="bf-meter__percent">
          <CountUp value={rounded} />%
        </span>
      </div>
      <div
        className="bf-meter__track"
        role="progressbar"
        data-tone={resolved}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={rounded}
        aria-label={ariaLabel}
      >
        <div className="bf-meter__fill" style={{ width: `${percent}%` }} />
      </div>
      <div className="bf-meter__foot">
        <span className="bf-meter__value">{valueText}</span>
        {countdown ? <span className="bf-meter__reset">resets in {countdown}</span> : null}
      </div>
      {detail ? <p className="bf-meter__detail">{detail}</p> : null}
    </div>
  );
}

export { usedPercentOf, toneFor };
