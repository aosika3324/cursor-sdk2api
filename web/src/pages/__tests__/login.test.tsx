import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LoginPage } from "../LoginPage";
import { I18nProvider } from "../../state/I18nContext";

const login = vi.fn();

vi.mock("../../state/AuthContext", () => ({
  useAuthContext: () => ({
    authenticated: false,
    checkedSession: true,
    authEnforced: true,
    login,
    logout: vi.fn(),
    markUnauthorized: vi.fn(),
  }),
}));

function renderLogin() {
  return render(
    <I18nProvider>
      <LoginPage />
    </I18nProvider>,
  );
}

afterEach(() => {
  login.mockReset();
});

describe("LoginPage", () => {
  it("renders a password field for the access key", () => {
    renderLogin();
    const input = screen.getByLabelText(/access key/i) as HTMLInputElement;
    expect(input.type).toBe("password");
  });

  it("shows an error notice when the key is wrong (login resolves false)", async () => {
    login.mockResolvedValue(false);
    renderLogin();
    fireEvent.change(screen.getByLabelText(/access key/i), { target: { value: "nope" } });
    fireEvent.submit(screen.getByTestId("login-form"));

    await waitFor(() => expect(login).toHaveBeenCalledWith("nope"));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("calls the auth login success path on a correct key", async () => {
    login.mockResolvedValue(true);
    renderLogin();
    fireEvent.change(screen.getByLabelText(/access key/i), { target: { value: "right" } });
    fireEvent.submit(screen.getByTestId("login-form"));

    await waitFor(() => expect(login).toHaveBeenCalledWith("right"));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
