import { catalogHasFable5 } from "./fable5.js";
import type { AccountPayload, ModelsPayload } from "./types.js";

export interface AccountBadge {
  kind: "plan" | "bot" | "fable" | "source";
  text: string;
  tone: "plan" | "ok" | "warn" | "off" | "muted";
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function num(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Row badges for the account table.
 *
 * Every badge is derived from data Cursor actually returned. An absent value
 * yields no badge rather than a guessed one, so "no Bot badge" and "Bot with no
 * quota left" stay visually distinct.
 */
export function accountBadges(
  account: AccountPayload | undefined,
  models: ModelsPayload | undefined,
  copy: {
    botWithQuota: string;
    botFull: string;
    botOff: string;
    planPercent: string;
    fableOn: string;
    fableOff: string;
  },
): AccountBadge[] {
  const badges: AccountBadge[] = [];
  const spending = (account?.spending ?? {}) as Record<string, unknown>;
  const limits = (account?.limits ?? {}) as Record<string, unknown>;

  const planName = str(spending.plan_name);
  if (planName) badges.push({ kind: "plan", text: planName, tone: "plan" });

  const grokBot = account?.grok_bot;
  if (grokBot?.available === true) {
    const used = num(grokBot.used_percent);
    const hasUsage = grokBot.has_available_usage;
    // "Full" is only claimed when Cursor says so, either explicitly or at 100%.
    const full = hasUsage === false || (used !== undefined && used >= 100);
    badges.push({
      kind: "bot",
      text: full ? copy.botFull : copy.botWithQuota,
      tone: full ? "warn" : "ok",
    });
  } else if (grokBot) {
    badges.push({ kind: "bot", text: copy.botOff, tone: "off" });
  }

  // When the plan is not yet exhausted, show how far along it is.
  const planPercent = num(limits.used_percent);
  if (planPercent !== undefined && planPercent < 100) {
    badges.push({
      kind: "plan",
      text: copy.planPercent.replace("{p}", planPercent.toFixed(1)),
      tone: "muted",
    });
  }

  if (models) {
    const hasFable = catalogHasFable5(models);
    badges.push({
      kind: "fable",
      text: hasFable ? copy.fableOn : copy.fableOff,
      tone: hasFable ? "ok" : "off",
    });
  }

  return badges;
}
