import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { I18nProvider, useI18n, COPY } from "../I18nContext";

vi.mock("../../api", () => ({
  getHealth: vi.fn(),
  getManagedAccounts: vi.fn(),
  probeManagedAccount: vi.fn(),
  getSettings: vi.fn(),
  getSettingsSchema: vi.fn(),
  updateSettings: vi.fn(),
}));

import * as api from "../../api";
import { AppStateProvider, useAppState } from "../AppStateContext";
import { AuthProvider, useAuthContext } from "../AuthContext";

describe("I18nContext", () => {
  it("exposes default-language copy via useI18n().t", () => {
    // navigator.language defaults to en in jsdom, so COPY.en is the baseline.
    function Probe() {
      const { t } = useI18n();
      return <span>{t.product}</span>;
    }
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByText(COPY.en.product)).toBeInTheDocument();
  });

  it("switches copy when the language changes", () => {
    function Probe() {
      const { t, lang, setLang } = useI18n();
      return (
        <div>
          <span data-testid="brand">{t.groupOperate}</span>
          <button type="button" onClick={() => setLang(lang === "en" ? "zh" : "en")}>
            toggle
          </button>
        </div>
      );
    }
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByTestId("brand")).toHaveTextContent(COPY.en.groupOperate);
    act(() => {
      screen.getByRole("button", { name: "toggle" }).click();
    });
    expect(screen.getByTestId("brand")).toHaveTextContent(COPY.zh.groupOperate);
  });

  it("throws when useI18n is used outside its provider", () => {
    function Orphan() {
      useI18n();
      return null;
    }
    // Silence the expected React error boundary console noise.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Orphan />)).toThrow(/I18nProvider/);
    spy.mockRestore();
  });
});

describe("AppStateContext", () => {
  beforeEach(() => {
    vi.mocked(api.getManagedAccounts).mockResolvedValue([]);
    vi.mocked(api.probeManagedAccount).mockResolvedValue({
      models: { data: [] },
      account: {},
    } as never);
  });

  function wrap(node: ReactNode) {
    return (
      <I18nProvider>
        <AppStateProvider>{node}</AppStateProvider>
      </I18nProvider>
    );
  }

  it("exposes fetched health via useAppState (useHealth)", async () => {
    vi.mocked(api.getHealth).mockResolvedValue({
      status: "ok",
      version: "9.9.9",
      capabilities: {},
      network: { proxy_configured: false },
    } as never);

    function Probe() {
      const { health } = useAppState();
      return <span data-testid="v">{health?.version ?? "…"}</span>;
    }

    render(wrap(<Probe />));
    await waitFor(() => expect(screen.getByTestId("v")).toHaveTextContent("9.9.9"));
    expect(api.getHealth).toHaveBeenCalledTimes(1);
  });

  it("loads the roster on mount from getManagedAccounts", async () => {
    vi.mocked(api.getHealth).mockResolvedValue({
      status: "ok",
      capabilities: {},
      network: { proxy_configured: false },
    } as never);
    vi.mocked(api.getManagedAccounts).mockResolvedValue([
      { id: "acct-1", key_hint: "abcd", added_at: 1 },
    ] as never);

    function Probe() {
      const { roster } = useAppState();
      return <span data-testid="n">{roster.length}</span>;
    }

    render(wrap(<Probe />));
    await waitFor(() => expect(screen.getByTestId("n")).toHaveTextContent("1"));
    expect(api.getManagedAccounts).toHaveBeenCalledTimes(1);
  });

  it("throws when useAppState is used outside its provider", () => {
    function Orphan() {
      useAppState();
      return null;
    }
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Orphan />)).toThrow(/AppStateProvider/);
    spy.mockRestore();
  });
});

describe("AuthContext", () => {
  it("defaults authenticated to true (behavior unchanged until C1)", () => {
    function Probe() {
      const { authenticated } = useAuthContext();
      return <span data-testid="a">{String(authenticated)}</span>;
    }
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    expect(screen.getByTestId("a")).toHaveTextContent("true");
  });

  it("throws when useAuthContext is used outside its provider", () => {
    function Orphan() {
      useAuthContext();
      return null;
    }
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Orphan />)).toThrow(/AuthProvider/);
    spy.mockRestore();
  });
});
