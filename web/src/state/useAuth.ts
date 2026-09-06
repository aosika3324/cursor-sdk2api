import { useCallback, useMemo, useState } from "react";

export interface AuthState {
  /**
   * Placeholder authentication flag. Defaults to `true` so console behavior is
   * unchanged until the real login flow lands in Task C1. Do NOT wire an API
   * call here — this scaffold only reserves the shape useAuth() will expose.
   */
  authenticated: boolean;
  setAuthenticated: (value: boolean) => void;
}

export function useAuth(): AuthState {
  const [authenticated, setAuthenticatedState] = useState(true);
  const setAuthenticated = useCallback((value: boolean) => setAuthenticatedState(value), []);
  return useMemo<AuthState>(() => ({ authenticated, setAuthenticated }), [authenticated, setAuthenticated]);
}
