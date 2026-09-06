import { createContext, useContext, type ReactNode } from "react";
import { useAuth, type AuthState } from "./useAuth";

const AuthContext = createContext<AuthState | null>(null);

/**
 * Auth scaffold. For now this only holds a placeholder `authenticated` flag
 * (default true), so the console renders exactly as before. Task C1 will wire
 * the real login flow / API into useAuth without changing this provider's
 * public surface.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const value = useAuth();
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthContext(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuthContext must be used within AuthProvider");
  return ctx;
}
