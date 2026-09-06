import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ActivityEntry } from "../../state/useActivityStream";
import type { LogEntry } from "../../state/useLogStream";

const setLogCapacity = vi.fn();
const getLogCapacity = vi.fn();
const getActivityStats = vi.fn();

vi.mock("../../api", () => ({
  getLogCapacity: (...args: unknown[]) => getLogCapacity(...args),
  setLogCapacity: (...args: unknown[]) => setLogCapacity(...args),
  getActivityStats: (...args: unknown[]) => getActivityStats(...args),
  UnauthorizedError: class UnauthorizedError extends Error {},
}));

let activityEntries: ActivityEntry[] = [];
let logEntries: LogEntry[] = [];
const clearActivity = vi.fn();
const clearLog = vi.fn();

vi.mock("../../state/useActivityStream", () => ({
  useActivityStream: () => ({ entries: activityEntries, clear: clearActivity }),
}));
vi.mock("../../state/useLogStream", () => ({
  useLogStream: () => ({ entries: logEntries, clear: clearLog }),
}));

import { LogsPage, isNearBottom } from "../LogsPage";
import { I18nProvider } from "../../state/I18nContext";

let cid = 0;
function activity(entry: {
  account: string;
  at: number;
  clientIp: string;
  model: string;
  status: number;
  credentialId?: string;
}): ActivityEntry {
  return { ...entry, clientId: cid++ };
}

function renderPage() {
  return render(
    <I18nProvider>
      <LogsPage />
    </I18nProvider>,
  );
}

afterEach(() => {
  cid = 0;
  activityEntries = [];
  logEntries = [];
  setLogCapacity.mockReset();
  getLogCapacity.mockReset();
  getActivityStats.mockReset();
  clearActivity.mockReset();
  clearLog.mockReset();
});

describe("LogsPage", () => {
  it("changing the capacity Select calls setLogCapacity(100)", async () => {
    getLogCapacity.mockResolvedValue({ capacity: 50, steps: [20, 30, 50, 100, 200, 300] });
    getActivityStats.mockResolvedValue({ rpm: 0 });
    setLogCapacity.mockResolvedValue({ capacity: 100, steps: [20, 30, 50, 100, 200, 300] });
    renderPage();

    const select = await screen.findByLabelText(/capacity|容量/i);
    fireEvent.change(select, { target: { value: "100" } });
    await waitFor(() => expect(setLogCapacity).toHaveBeenCalledWith(100));
  });

  it("a status-code filter narrows the visible activity rows", async () => {
    getLogCapacity.mockResolvedValue({ capacity: 50, steps: [20, 30, 50, 100, 200, 300] });
    getActivityStats.mockResolvedValue({ rpm: 3 });
    activityEntries = [
      activity({ account: "acct-ok", at: 1, clientIp: "10.0.0.1", model: "sonnet", status: 200 }),
      activity({ account: "acct-bad", at: 2, clientIp: "10.0.0.2", model: "opus", status: 500 }),
    ];
    renderPage();

    expect(await screen.findByText("acct-ok")).toBeInTheDocument();
    expect(screen.getByText("acct-bad")).toBeInTheDocument();

    const statusFilter = screen.getByLabelText(/status code|状态码/i);
    fireEvent.change(statusFilter, { target: { value: "200" } });

    expect(screen.getByText("acct-ok")).toBeInTheDocument();
    expect(screen.queryByText("acct-bad")).toBeNull();
  });

  it("renders a success StatusTag for 2xx and a danger StatusTag for 4xx/5xx", async () => {
    getLogCapacity.mockResolvedValue({ capacity: 50, steps: [20, 30, 50, 100, 200, 300] });
    getActivityStats.mockResolvedValue({ rpm: 0 });
    activityEntries = [
      activity({ account: "row-200", at: 1, clientIp: "10.0.0.1", model: "sonnet", status: 200 }),
      activity({ account: "row-429", at: 2, clientIp: "10.0.0.2", model: "opus", status: 429 }),
      activity({ account: "row-500", at: 3, clientIp: "10.0.0.3", model: "grok", status: 500 }),
    ];
    renderPage();

    const okRow = (await screen.findByText("row-200")).closest("tr") as HTMLElement;
    expect(within(okRow).getByText("200").closest(".bf-status-tag")).toHaveClass(
      "bf-status-tag--success",
    );

    const rateRow = screen.getByText("row-429").closest("tr") as HTMLElement;
    expect(within(rateRow).getByText("429").closest(".bf-status-tag")).toHaveClass(
      "bf-status-tag--danger",
    );

    const errRow = screen.getByText("row-500").closest("tr") as HTMLElement;
    expect(within(errRow).getByText("500").closest(".bf-status-tag")).toHaveClass(
      "bf-status-tag--danger",
    );
  });

  it("clear-all empties the activity buffer via the hook clear()", async () => {
    getLogCapacity.mockResolvedValue({ capacity: 50, steps: [20, 30, 50, 100, 200, 300] });
    getActivityStats.mockResolvedValue({ rpm: 0 });
    activityEntries = [activity({ account: "acct", at: 1, clientIp: "10.0.0.1", model: "sonnet", status: 200 })];
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /clear all|清空全部/i }));
    expect(clearActivity).toHaveBeenCalled();
  });

  it("export-selected emits exactly the selected rows and selection survives a filter change", async () => {
    getLogCapacity.mockResolvedValue({ capacity: 50, steps: [20, 30, 50, 100, 200, 300] });
    getActivityStats.mockResolvedValue({ rpm: 0 });
    activityEntries = [
      activity({ account: "keep-me", at: 1, clientIp: "10.0.0.1", model: "sonnet", status: 200 }),
      activity({ account: "other", at: 2, clientIp: "10.0.0.2", model: "opus", status: 200 }),
      activity({ account: "noise", at: 3, clientIp: "10.0.0.3", model: "grok", status: 500 }),
    ];
    renderPage();

    // Select the first row by its identity.
    fireEvent.click(await screen.findByLabelText(/keep-me/i));

    // Filtering out the 500 row shifts positions; the selected row must stay checked.
    const statusFilter = screen.getByLabelText(/status code|状态码/i);
    fireEvent.change(statusFilter, { target: { value: "2" } });
    expect((screen.getByLabelText(/keep-me/i) as HTMLInputElement).checked).toBe(true);

    // Capture the exported payload. jsdom's Blob has no .text(), so intercept
    // the Blob constructor parts and stub URL.createObjectURL/revokeObjectURL.
    const parts: string[] = [];
    const OriginalBlob = globalThis.Blob;
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    globalThis.Blob = class extends OriginalBlob {
      constructor(blobParts?: BlobPart[], options?: BlobPropertyBag) {
        super(blobParts, options);
        for (const part of blobParts ?? []) parts.push(String(part));
      }
    } as typeof Blob;
    URL.createObjectURL = (() => "blob:mock") as typeof URL.createObjectURL;
    URL.revokeObjectURL = (() => {}) as typeof URL.revokeObjectURL;

    fireEvent.click(screen.getByRole("button", { name: /export selected|导出所选/i }));

    const parsed = JSON.parse(parts.join("")) as Array<{ account: string }>;
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.account).toBe("keep-me");

    globalThis.Blob = OriginalBlob;
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  });

  it("stops RPM polling when auto-refresh is switched off", async () => {
    vi.useFakeTimers();
    try {
      getLogCapacity.mockResolvedValue({ capacity: 50, steps: [20, 30, 50, 100, 200, 300] });
      getActivityStats.mockResolvedValue({ rpm: 1 });
      renderPage();

      // Initial poll on mount.
      await vi.waitFor(() => expect(getActivityStats).toHaveBeenCalledTimes(1));

      const toggle = screen.getByRole("switch", { name: /auto refresh|自动刷新/i });
      fireEvent.click(toggle);
      getActivityStats.mockClear();

      // Advancing well past the 5s interval must not trigger any further polls.
      await vi.advanceTimersByTimeAsync(20000);
      expect(getActivityStats).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("isNearBottom", () => {
  it("follows the tail only when the user is near the bottom", () => {
    // Scrolled to the bottom: 1000 - 960 - 40 = 0 < 40 → near bottom.
    expect(isNearBottom({ scrollHeight: 1000, scrollTop: 960, clientHeight: 40 })).toBe(true);
    // Scrolled up to read history: 1000 - 100 - 40 = 860 → not near bottom.
    expect(isNearBottom({ scrollHeight: 1000, scrollTop: 100, clientHeight: 40 })).toBe(false);
  });
});
