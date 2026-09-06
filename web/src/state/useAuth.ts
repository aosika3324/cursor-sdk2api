import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getManagedAccounts,
  getSession,
  login as apiLogin,
  logout as apiLogout,
  UnauthorizedError,
} from "../api";

export interface AuthState {
  /** Whether the console is currently authenticated (or auth is not enforced). */
  authenticated: boolean;
  /** False until the initial session probe resolves; gate rendering on this. */
  checkedSession: boolean;
  /**
   * True when the deployment does NOT enforce console auth (byok mode). In that
   * case there is no login flow and the UI should never show the login gate.
   */
  authEnforced: boolean;
  /** Submit an access key; resolves true on success (and flips authenticated). */
  login: (accessKey: string) => Promise<boolean>;
  /** End the session and drop back to the login gate. */
  logout: () => Promise<void>;
  /** Called when a management request throws UnauthorizedError mid-session. */
  markUnauthorized: () => void;
}

export function useAuth(): AuthState {
  const [authenticated, setAuthenticated] = useState(false);
  const [checkedSession, setCheckedSession] = useState(false);
  const [authEnforced, setAuthEnforced] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        let ok = false;
        try {
          ok = await getSession();
        } catch {
          if (cancelled) return;
          // Session probe itself failed (network/server blip). Don't strand a
          // byok deploy behind an unpassable gate — fail open like the
          // getManagedAccounts non-Unauthorized branch below.
          setAuthEnforced(false);
          setAuthenticated(true);
          return;
        }
        if (cancelled) return;
        if (ok) {
          setAuthenticated(true);
          setAuthEnforced(true);
          return;
        }
        // Session is not valid. Distinguish managed (login required) from byok
        // (management is ungated) by probing an ungated management endpoint: in
        // byok it succeeds, in managed it throws UnauthorizedError.
        try {
          await getManagedAccounts();
          if (cancelled) return;
          setAuthEnforced(false);
          setAuthenticated(true);
        } catch (error) {
          if (cancelled) return;
          if (error instanceof UnauthorizedError) {
            setAuthEnforced(true);
            setAuthenticated(false);
          } else {
            // Network / server error: don't lock the operator out over a blip.
            setAuthEnforced(false);
            setAuthenticated(true);
          }
        }
      } finally {
        if (!cancelled) setCheckedSession(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (accessKey: string): Promise<boolean> => {
    const ok = await apiLogin(accessKey);
    if (ok) {
      setAuthEnforced(true);
      setAuthenticated(true);
    }
    return ok;
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    try {
      await apiLogout();
    } finally {
      setAuthenticated(false);
    }
  }, []);

  // NOTE: exposed for mid-session 401 handling but intentionally NOT yet wired
  // into the data hooks (useRoster/useHealth/useSettings). Wiring it piecemeal
  // into each hook's catch is lower quality than a single central 401
  // interception; that is tracked as a deliberate follow-up.
  const markUnauthorized = useCallback(() => setAuthenticated(false), []);

  return useMemo<AuthState>(
    () => ({ authenticated, checkedSession, authEnforced, login, logout, markUnauthorized }),
    [authenticated, checkedSession, authEnforced, login, logout, markUnauthorized],
  );
}
