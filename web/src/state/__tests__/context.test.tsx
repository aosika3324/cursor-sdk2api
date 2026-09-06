import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import { I18nProvider, useI18n, COPY } from "../I18nContext";

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
