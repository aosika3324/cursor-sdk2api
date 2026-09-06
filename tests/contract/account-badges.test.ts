import { describe, expect, it } from "vitest";
import { accountBadges } from "../../web/src/badges.js";
import type { AccountPayload, ModelsPayload } from "../../web/src/types.js";

const copy = {
  botWithQuota: "Bot (quota left)",
  botFull: "Bot (plan full)",
  botOff: "Bot off",
  planPercent: "Plan {p}%",
  fableOn: "F5",
  fableOff: "F5 x",
};

function account(over: Partial<AccountPayload> = {}): AccountPayload {
  return {
    status: "ok",
    identity: null,
    capabilities: { identity: true, spending: true, limits: true },
    ...over,
  } as AccountPayload;
}

const models = (ids: string[]): ModelsPayload =>
  ({ object: "list", data: ids.map((id) => ({ id, object: "model" })) }) as unknown as ModelsPayload;

describe("account badges", () => {
  it("shows the plan name from Cursor", () => {
    const badges = accountBadges(account({ spending: { plan_name: "Ultra" } }), undefined, copy);
    expect(badges.find((b) => b.kind === "plan")?.text).toBe("Ultra");
  });

  it("marks the Bot channel full when Cursor reports no available usage", () => {
    const badges = accountBadges(
      account({ grok_bot: { available: true, used_percent: 42, has_available_usage: false } }),
      undefined,
      copy,
    );
    expect(badges.find((b) => b.kind === "bot")).toMatchObject({ text: copy.botFull, tone: "warn" });
  });

  it("marks the Bot channel full at 100 percent", () => {
    const badges = accountBadges(
      account({ grok_bot: { available: true, used_percent: 100 } }),
      undefined,
      copy,
    );
    expect(badges.find((b) => b.kind === "bot")?.text).toBe(copy.botFull);
  });

  it("shows quota left when the Bot channel still has room", () => {
    const badges = accountBadges(
      account({ grok_bot: { available: true, used_percent: 12, has_available_usage: true } }),
      undefined,
      copy,
    );
    expect(badges.find((b) => b.kind === "bot")).toMatchObject({ text: copy.botWithQuota, tone: "ok" });
  });

  it("distinguishes an unavailable Bot channel from an absent one", () => {
    const off = accountBadges(account({ grok_bot: { available: false } }), undefined, copy);
    expect(off.find((b) => b.kind === "bot")?.text).toBe(copy.botOff);

    const absent = accountBadges(account(), undefined, copy);
    expect(absent.find((b) => b.kind === "bot")).toBeUndefined();
  });

  it("shows plan percent only while the plan is not exhausted", () => {
    const partial = accountBadges(account({ limits: { used_percent: 82.5 } }), undefined, copy);
    expect(partial.some((b) => b.text === "Plan 82.5%")).toBe(true);

    const full = accountBadges(account({ limits: { used_percent: 100 } }), undefined, copy);
    expect(full.some((b) => b.text.startsWith("Plan "))).toBe(false);
  });

  it("reports Fable 5 from the live catalog and omits it when untested", () => {
    const on = accountBadges(account(), models(["claude-fable-5"]), copy);
    expect(on.find((b) => b.kind === "fable")?.text).toBe(copy.fableOn);

    const off = accountBadges(account(), models(["claude-sonnet-4-6"]), copy);
    expect(off.find((b) => b.kind === "fable")?.text).toBe(copy.fableOff);

    const untested = accountBadges(account(), undefined, copy);
    expect(untested.find((b) => b.kind === "fable")).toBeUndefined();
  });

  it("returns no badges when Cursor returned nothing", () => {
    expect(accountBadges(undefined, undefined, copy)).toEqual([]);
  });
});
