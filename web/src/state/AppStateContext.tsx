import { createContext, useContext, type ReactNode } from "react";
import { useI18n } from "./I18nContext";
import { useHealth, type HealthState } from "./useHealth";
import { useRoster, type RosterState } from "./useRoster";

export type AppState = HealthState & RosterState;

const AppStateContext = createContext<AppState | null>(null);

/**
 * Composes the data hooks (health + roster) into a single app-state value.
 * This is a direct relocation of the state that used to live in App.tsx; the
 * fetch endpoints, mount-time fetches and refresh semantics are unchanged.
 */
export function AppStateProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const health = useHealth();
  const roster = useRoster(t);
  const value: AppState = { ...health, ...roster };
  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState(): AppState {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error("useAppState must be used within AppStateProvider");
  return ctx;
}
