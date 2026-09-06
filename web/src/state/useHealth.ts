import { useCallback, useEffect, useState } from "react";
import { getHealth } from "../api";
import type { HealthPayload } from "../types";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed";
}

export interface HealthState {
  health?: HealthPayload;
  healthError: string;
  refreshingHealth: boolean;
  refreshHealth: () => Promise<void>;
}

/**
 * Owns the /health snapshot. Mirrors the previous App.tsx logic exactly:
 * one fetch on mount and a manual refresh that flips the refreshing flag.
 */
export function useHealth(): HealthState {
  const [health, setHealth] = useState<HealthPayload>();
  const [healthError, setHealthError] = useState("");
  const [refreshingHealth, setRefreshingHealth] = useState(false);

  const refreshHealth = useCallback(async () => {
    setRefreshingHealth(true);
    try {
      setHealth(await getHealth());
      setHealthError("");
    } catch (error: unknown) {
      setHealthError(messageOf(error));
    } finally {
      setRefreshingHealth(false);
    }
  }, []);

  useEffect(() => {
    void refreshHealth();
  }, [refreshHealth]);

  return { health, healthError, refreshingHealth, refreshHealth };
}
