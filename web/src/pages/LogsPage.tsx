import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button } from "../bflabs/Button";
import { Card } from "../bflabs/Card";
import { Checkbox } from "../bflabs/Checkbox";
import { Input } from "../bflabs/Input";
import { Select } from "../bflabs/Select";
import { StatusTag, type StatusTagTone } from "../bflabs/StatusTag";
import { Switch } from "../bflabs/Switch";
import { getActivityStats, getLogCapacity, setLogCapacity } from "../api";
import { useI18n } from "../state/I18nContext";
import { useActivityStream, type ActivityEntry } from "../state/useActivityStream";
import { useLogStream, type LogEntry } from "../state/useLogStream";
import { PageFrame } from "./shared";

const DEFAULT_STEPS = [20, 30, 50, 100, 200, 300];

type LogsCopy = ReturnType<typeof useI18n>["t"]["logs"];

/** Map an HTTP-ish status to a bflabs StatusTag tone: 2xx→success, 4xx/5xx→danger. */
function statusTone(status: number): StatusTagTone {
  if (status >= 200 && status < 300) return "success";
  if (status >= 400) return "danger";
  return "progress";
}

function formatTime(at: number): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return String(at);
  return date.toLocaleTimeString();
}

/** Stable per-row identity assigned on ingest — survives filtering/trimming. */
function rowKey(entry: ActivityEntry): string {
  return String(entry.clientId);
}

/**
 * True when a scroll container is within `threshold` px of the bottom. Extracted
 * so the auto-scroll "follow the tail unless the user scrolled up" decision is
 * unit-testable without a real layout.
 */
export function isNearBottom(
  metrics: { scrollHeight: number; scrollTop: number; clientHeight: number },
  threshold = 40,
): boolean {
  return metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight < threshold;
}

export function LogsPage() {
  const t = useI18n().t.logs;

  // --- Request activity panel -------------------------------------------------
  const [activityEnabled, setActivityEnabled] = useState(true);
  const { entries: activity, clear: clearActivity } = useActivityStream(activityEnabled);
  const [statusFilter, setStatusFilter] = useState("");
  const [credentialFilter, setCredentialFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rpm, setRpm] = useState<number | null>(null);
  const [steps, setSteps] = useState<number[]>(DEFAULT_STEPS);
  const [capacity, setCapacity] = useState<number | null>(null);

  const refreshStats = useMemo(
    () => async () => {
      try {
        setRpm((await getActivityStats()).rpm);
      } catch {
        /* transient; leave prior value */
      }
    },
    [],
  );

  useEffect(() => {
    void (async () => {
      try {
        const cap = await getLogCapacity();
        setCapacity(cap.capacity);
        if (cap.steps?.length) setSteps(cap.steps);
      } catch {
        /* keep defaults */
      }
    })();
  }, []);

  useEffect(() => {
    if (!activityEnabled) return;
    void refreshStats();
    const timer = window.setInterval(() => void refreshStats(), 5000);
    return () => window.clearInterval(timer);
  }, [refreshStats, activityEnabled]);

  const filteredActivity = useMemo(() => {
    const status = statusFilter.trim();
    const cred = credentialFilter.trim().toLowerCase();
    return activity.filter((entry) => {
      if (status && !String(entry.status).startsWith(status)) return false;
      if (cred && !(entry.credentialId ?? "").toLowerCase().includes(cred)) return false;
      return true;
    });
  }, [activity, statusFilter, credentialFilter]);

  const onCapacityChange = async (value: number) => {
    setCapacity(value);
    try {
      const next = await setLogCapacity(value);
      setCapacity(next.capacity);
      if (next.steps?.length) setSteps(next.steps);
    } catch {
      /* keep optimistic value */
    }
  };

  const toggleRow = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const exportSelected = () => {
    const rows = filteredActivity.filter((entry) => selected.has(rowKey(entry)));
    const payload = rows.length > 0 ? rows : filteredActivity;
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `activity-${Date.now()}.json`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const clearFilters = () => {
    setStatusFilter("");
    setCredentialFilter("");
    setSelected(new Set());
  };

  const clearAllActivity = () => {
    clearActivity();
    setSelected(new Set());
  };

  return (
    <PageFrame title={t.title} kicker={t.kicker}>
      <ActivityPanel
        t={t}
        rpm={rpm}
        steps={steps}
        capacity={capacity}
        statusFilter={statusFilter}
        credentialFilter={credentialFilter}
        rows={filteredActivity}
        selected={selected}
        autoRefresh={activityEnabled}
        onStatusFilter={setStatusFilter}
        onCredentialFilter={setCredentialFilter}
        onCapacity={(v) => void onCapacityChange(v)}
        onRefresh={() => void refreshStats()}
        onClearFilters={clearFilters}
        onExport={exportSelected}
        onClearAll={clearAllActivity}
        onAutoRefresh={setActivityEnabled}
        onToggleRow={toggleRow}
      />
      <LogPanel t={t} />
    </PageFrame>
  );
}

function logTone(level: string): StatusTagTone {
  const normalized = level.toLowerCase();
  if (normalized === "error") return "danger";
  if (normalized === "warn" || normalized === "warning") return "progress";
  return "neutral";
}

function LogPanel({ t }: { t: LogsCopy }) {
  const [enabled, setEnabled] = useState(true);
  const [level, setLevel] = useState<"all" | "info" | "warn" | "error">("all");
  const { entries, clear } = useLogStream(enabled);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Capture "was the user near the bottom" synchronously before the DOM paints
  // the new entries, so a live tail follows but scrolling up to read history
  // is never interrupted.
  const wasNearBottom = useRef(true);

  const visible = useMemo<LogEntry[]>(() => {
    if (level === "all") return entries;
    return entries.filter((entry) => {
      const normalized = entry.level?.toLowerCase();
      if (level === "warn") return normalized === "warn" || normalized === "warning";
      return normalized === level;
    });
  }, [entries, level]);

  useLayoutEffect(() => {
    const node = scrollRef.current;
    if (node && wasNearBottom.current) node.scrollTop = node.scrollHeight;
  }, [visible]);

  const onScroll = () => {
    const node = scrollRef.current;
    if (node) wasNearBottom.current = isNearBottom(node);
  };

  return (
    <Card as="section" title={t.streamTitle} description={t.streamHint}>
      <div className="logs-toolbar" role="group" aria-label={t.streamTitle}>
        <label className="logs-field">
          <span className="logs-field__label">{t.level}</span>
          <Select
            aria-label={t.level}
            value={level}
            onChange={(event) => setLevel(event.target.value as typeof level)}
          >
            <option value="all">{t.levelAll}</option>
            <option value="info">{t.levelInfo}</option>
            <option value="warn">{t.levelWarn}</option>
            <option value="error">{t.levelError}</option>
          </Select>
        </label>
        <div className="logs-toolbar__actions">
          <Switch
            checked={enabled}
            label={enabled ? t.pause : t.resume}
            onChange={(event) => setEnabled(event.target.checked)}
          />
          <Button variant="quiet" size="sm" onClick={clear}>{t.clear}</Button>
        </div>
      </div>
      <div className="logs-stream mono" ref={scrollRef} onScroll={onScroll} role="log" aria-live="polite">
        {visible.length === 0 ? (
          <p className="logs-empty">{t.noLogs}</p>
        ) : (
          visible.map((entry, index) => (
            <div className="logs-line" key={`${entry.at}-${index}`}>
              <StatusTag tone={logTone(entry.level)} showDot={false} className="logs-line__level">
                {entry.level}
              </StatusTag>
              <time className="logs-line__at">{formatTime(entry.at)}</time>
              <span className="logs-line__msg">{entry.msg}</span>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}

function ActivityPanel({
  t,
  rpm,
  steps,
  capacity,
  statusFilter,
  credentialFilter,
  rows,
  selected,
  autoRefresh,
  onStatusFilter,
  onCredentialFilter,
  onCapacity,
  onRefresh,
  onClearFilters,
  onExport,
  onClearAll,
  onAutoRefresh,
  onToggleRow,
}: {
  t: LogsCopy;
  rpm: number | null;
  steps: number[];
  capacity: number | null;
  statusFilter: string;
  credentialFilter: string;
  rows: ActivityEntry[];
  selected: Set<string>;
  autoRefresh: boolean;
  onStatusFilter: (value: string) => void;
  onCredentialFilter: (value: string) => void;
  onCapacity: (value: number) => void;
  onRefresh: () => void;
  onClearFilters: () => void;
  onExport: () => void;
  onClearAll: () => void;
  onAutoRefresh: (value: boolean) => void;
  onToggleRow: (key: string) => void;
}) {
  const count = t.recordCount.replace("{n}", String(rows.length));
  return (
    <Card as="section" title={t.activityTitle} description={t.activityHint}>
      <div className="logs-toolbar" role="group" aria-label={t.activityTitle}>
        <span className="logs-rpm mono" title={t.rpm}>
          <strong>{rpm ?? "—"}</strong> {t.rpm}
        </span>
        <label className="logs-field">
          <span className="logs-field__label">{t.statusFilter}</span>
          <Input
            inputMode="numeric"
            value={statusFilter}
            placeholder={t.statusFilterPlaceholder}
            aria-label={t.statusFilter}
            onChange={(event) => onStatusFilter(event.target.value)}
          />
        </label>
        <label className="logs-field">
          <span className="logs-field__label">{t.credentialFilter}</span>
          <Input
            value={credentialFilter}
            placeholder={t.credentialFilterPlaceholder}
            aria-label={t.credentialFilter}
            onChange={(event) => onCredentialFilter(event.target.value)}
          />
        </label>
        <label className="logs-field">
          <span className="logs-field__label">{t.capacity}</span>
          <Select
            aria-label={t.capacity}
            value={capacity ?? ""}
            onChange={(event) => onCapacity(Number.parseInt(event.target.value, 10))}
          >
            {steps.map((step) => (
              <option key={step} value={step}>
                {step}
              </option>
            ))}
          </Select>
        </label>
        <div className="logs-toolbar__actions">
          <Button variant="quiet" size="sm" onClick={onRefresh}>{t.refresh}</Button>
          <Button variant="quiet" size="sm" onClick={onClearFilters}>{t.clearFilters}</Button>
          <Button variant="secondary" size="sm" onClick={onExport}>{t.exportSelected}</Button>
          <Button variant="quiet" size="sm" className="logs-danger" onClick={onClearAll}>{t.clearAll}</Button>
          <Switch
            checked={autoRefresh}
            label={t.autoRefresh}
            onChange={(event) => onAutoRefresh(event.target.checked)}
          />
        </div>
        <span className="logs-count mono">{count}</span>
      </div>
      <div className="table-wrap">
        <table className="grid-table logs-table">
          <thead>
            <tr>
              <th className="col-select" scope="col">{t.colSelect}</th>
              <th scope="col">{t.colAccount}</th>
              <th scope="col">{t.colTime}</th>
              <th scope="col">{t.colClientIp}</th>
              <th scope="col">{t.colModel}</th>
              <th scope="col">{t.colStatus}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="logs-empty">{t.noActivity}</td>
              </tr>
            ) : (
              rows.map((entry) => {
                const key = rowKey(entry);
                return (
                  <tr key={key}>
                    <td className="col-select">
                      <Checkbox
                        checked={selected.has(key)}
                        aria-label={`${t.colSelect} ${entry.account}`}
                        onChange={() => onToggleRow(key)}
                      />
                    </td>
                    <td className="mono">{entry.account}</td>
                    <td className="mono">{formatTime(entry.at)}</td>
                    <td className="mono">{entry.clientIp}</td>
                    <td className="mono">{entry.model}</td>
                    <td>
                      <StatusTag tone={statusTone(entry.status)}>{entry.status}</StatusTag>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
