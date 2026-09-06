import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AccountEditModal } from "../AccountEditModal";
import { ConfirmDialog } from "../ConfirmDialog";
import { I18nProvider } from "../../state/I18nContext";
import type { RosterItem } from "../../roster";

const sampleItem: RosterItem = {
  id: "acc-1",
  keyHint: "crsr_…abcd",
  addedAt: 1,
  testState: "idle",
  label: "Primary",
  note: "team key",
  priority: 42,
  disabled: true,
  proxy: { configured: true, scheme: "http", host: "proxy.local:8080", has_username: true, has_password: true },
};

function renderModal(overrides: Partial<Parameters<typeof AccountEditModal>[0]> = {}) {
  const onSaveAccount = vi.fn().mockResolvedValue(true);
  const onSaveProxy = vi.fn().mockResolvedValue(true);
  const onSaveProfile = vi.fn().mockResolvedValue(true);
  const onClose = vi.fn();
  render(
    <I18nProvider>
      <AccountEditModal
        open
        item={sampleItem}
        sandCapable={false}
        onClose={onClose}
        onSaveAccount={onSaveAccount}
        onSaveProxy={onSaveProxy}
        onSaveProfile={onSaveProfile}
        {...overrides}
      />
    </I18nProvider>,
  );
  return { onSaveAccount, onSaveProxy, onSaveProfile, onClose };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AccountEditModal", () => {
  it("pre-fills fields from the account", () => {
    renderModal();
    const label = screen.getByLabelText(/label/i) as HTMLInputElement;
    const priority = screen.getByLabelText(/priority/i) as HTMLInputElement;
    const disabled = screen.getByRole("switch") as HTMLInputElement;
    expect(label.value).toBe("Primary");
    expect(priority.value).toBe("42");
    expect(disabled.checked).toBe(true);
  });

  it("saves the edited label through onSaveAccount", async () => {
    const { onSaveAccount } = renderModal();
    fireEvent.change(screen.getByLabelText(/label/i), { target: { value: "Renamed" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await vi.waitFor(() =>
      expect(onSaveAccount).toHaveBeenCalledWith(
        "acc-1",
        expect.objectContaining({ label: "Renamed", note: "team key", priority: 42, disabled: true }),
      ),
    );
  });

  it("sends a url-only proxy update (no creds) when only the URL changes", async () => {
    const { onSaveProxy, onClose } = renderModal();
    fireEvent.change(screen.getByLabelText(/proxy url/i), {
      target: { value: "http://new.proxy:3128" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await vi.waitFor(() =>
      expect(onSaveProxy).toHaveBeenCalledWith("acc-1", { url: "http://new.proxy:3128" }),
    );
    // No username/password keys — backend preserves stored creds.
    const proxyArg = onSaveProxy.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(proxyArg).not.toHaveProperty("username");
    expect(proxyArg).not.toHaveProperty("password");
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("runs multiple mutations in one save (account + proxy + profile)", async () => {
    const { onSaveAccount, onSaveProxy, onSaveProfile } = renderModal({ sandCapable: true });
    fireEvent.change(screen.getByLabelText(/label/i), { target: { value: "Multi" } });
    fireEvent.change(screen.getByLabelText(/proxy url/i), { target: { value: "http://p:8000" } });
    fireEvent.change(screen.getByLabelText(/default runtime/i), { target: { value: "sand" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await vi.waitFor(() => {
      expect(onSaveAccount).toHaveBeenCalledTimes(1);
      expect(onSaveProxy).toHaveBeenCalledTimes(1);
      expect(onSaveProfile).toHaveBeenCalledWith("acc-1", "sand");
    });
  });

  it("disables the sand option when sandCapable is false", () => {
    renderModal({ sandCapable: false });
    const sandOption = screen.getByRole("option", { name: /sand/i }) as HTMLOptionElement;
    expect(sandOption.disabled).toBe(true);
  });

  it("keeps the modal open and shows an error when a mutation fails", async () => {
    const onSaveAccount = vi.fn().mockResolvedValue(false);
    const { onClose } = renderModal({ onSaveAccount });
    fireEvent.change(screen.getByLabelText(/label/i), { target: { value: "Boom" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("ConfirmDialog", () => {
  it("only calls onConfirm after the confirm button is clicked", () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(
      <I18nProvider>
        <ConfirmDialog
          open
          title="Remove account"
          body="This cannot be undone."
          confirmLabel="Delete"
          onConfirm={onConfirm}
          onClose={onClose}
        />
      </I18nProvider>,
    );
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /delete/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
