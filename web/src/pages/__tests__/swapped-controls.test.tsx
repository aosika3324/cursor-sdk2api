import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PlaygroundPage } from "../PlaygroundPage";
import { AccountsPage } from "../AccountsPage";
import { I18nProvider } from "../../state/I18nContext";
import type { RosterItem } from "../../roster";

afterEach(cleanup);

const rosterItem: RosterItem = {
  id: "acc-1",
  keyHint: "crsr_…abcd",
  addedAt: 1,
  testState: "idle",
  models: {
    object: "list",
    status: "ok",
    data: [{ id: "gpt-x", display_name: "GPT-X" }],
    cache: { stale: false },
  } as RosterItem["models"],
};

function renderPlayground(overrides: Partial<Parameters<typeof PlaygroundPage>[0]> = {}) {
  const props = {
    roster: [rosterItem],
    activeId: "acc-1",
    protocol: "messages" as const,
    selectedModel: "gpt-x",
    prompt: "hello",
    stream: true,
    output: "",
    runState: "idle",
    onActive: vi.fn(),
    onProtocol: vi.fn(),
    onModel: vi.fn(),
    onPrompt: vi.fn(),
    onStream: vi.fn(),
    onRun: vi.fn(),
    ...overrides,
  };
  render(
    <I18nProvider>
      <PlaygroundPage {...props} />
    </I18nProvider>,
  );
  return props;
}

describe("PlaygroundPage swapped controls", () => {
  it("account select fires onActive via bflabs Select", () => {
    const onActive = vi.fn();
    renderPlayground({ onActive });
    const selects = Array.from(document.querySelectorAll(".bf-select__control"));
    fireEvent.change(selects[0] as Element, { target: { value: "acc-1" } });
    expect(onActive).toHaveBeenCalledWith("acc-1");
  });

  it("model select fires onModel", () => {
    const onModel = vi.fn();
    renderPlayground({ onModel });
    const selects = Array.from(document.querySelectorAll(".bf-select__control"));
    fireEvent.change(selects[1] as Element, { target: { value: "gpt-x" } });
    expect(onModel).toHaveBeenCalledWith("gpt-x");
  });

  it("prompt textarea fires onPrompt via bflabs Textarea", () => {
    const onPrompt = vi.fn();
    renderPlayground({ onPrompt });
    const textarea = document.querySelector(".bf-textarea");
    expect(textarea).not.toBeNull();
    fireEvent.change(textarea as Element, { target: { value: "new prompt" } });
    expect(onPrompt).toHaveBeenCalledWith("new prompt");
  });
});

function renderAccounts(overrides: Partial<Parameters<typeof AccountsPage>[0]> = {}) {
  const props = {
    draftKey: "",
    addError: "",
    adding: false,
    roster: [] as RosterItem[],
    onDraft: vi.fn(),
    onAdd: vi.fn(),
    onTest: vi.fn(),
    onRemove: vi.fn(),
    onEdit: vi.fn(),
    onProxy: vi.fn(),
    onVerify: vi.fn(),
    onDisable: vi.fn(),
    onBatch: vi.fn(),
    onMove: vi.fn(),
    onQuota: vi.fn(),
    onOnboard: vi.fn(),
    onboarding: false,
    ...overrides,
  };
  render(
    <I18nProvider>
      <AccountsPage {...props} />
    </I18nProvider>,
  );
  return props;
}

describe("AccountsPage swapped controls", () => {
  it("key input fires onDraft via bflabs Input", () => {
    const onDraft = vi.fn();
    renderAccounts({ onDraft });
    const input = document.querySelector(".bf-input");
    expect(input).not.toBeNull();
    fireEvent.change(input as Element, { target: { value: "crsr_secret" } });
    expect(onDraft).toHaveBeenCalledWith("crsr_secret");
  });

  it("token import onboards with checkbox flags preserved", () => {
    const onOnboard = vi.fn();
    renderAccounts({ onOnboard });
    fireEvent.click(screen.getByRole("tab", { name: /token/i }));
    const input = document.querySelector(".bf-input");
    fireEvent.change(input as Element, { target: { value: "  session-jwt  " } });
    const form = (input as Element).closest("form");
    fireEvent.submit(form as Element);
    expect(onOnboard).toHaveBeenCalledWith("session-jwt", true, true);
  });
});
