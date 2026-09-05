import { chmodSync, existsSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensurePrivateDir } from "../lineage-store.js";
import {
  defaultRuntimeSettings,
  SETTINGS_VERSION,
  type RuntimeSettings,
} from "./schema.js";
import { applySettingsPatch, coerceStoredSettings, SettingsValidationError } from "./validate.js";

const BACKUP_PREFIX = "config.json.bak-";
const BACKUPS_KEPT = 10;

interface SettingsFile {
  version: number;
  seeded_from_env: boolean;
  updated_at: number;
  settings: Record<string, unknown>;
}

/**
 * Owns `$STATE_DIR/config.json`.
 *
 * Env seeds the file exactly once. After that the file is the single source of
 * truth, so a console change is not silently reverted by a stale compose env on
 * the next restart.
 *
 * A corrupt file fails closed rather than resetting to defaults: silently
 * discarding an operator's configuration is worse than refusing to start.
 */
export class SettingsStore {
  readonly path: string;
  private current: RuntimeSettings;
  private seededFromEnv: boolean;
  private listeners: Array<(settings: RuntimeSettings) => void> = [];

  constructor(stateDir: string, envSeed: Partial<RuntimeSettings> = {}) {
    ensurePrivateDir(stateDir);
    this.path = join(stateDir, "config.json");
    if (existsSync(this.path)) {
      const loaded = this.load();
      this.current = loaded.settings;
      this.seededFromEnv = loaded.seededFromEnv;
      return;
    }
    // Env seeds are clamped the same way a stored file is: a host that runs with
    // deliberately small timeouts must still be able to start.
    this.current = coerceStoredSettings(
      defaultRuntimeSettings(),
      { ...defaultRuntimeSettings(), ...envSeed } as unknown as Record<string, unknown>,
    );
    this.seededFromEnv = true;
    this.persist();
  }

  get(): RuntimeSettings {
    return { ...this.current };
  }

  isSeededFromEnv(): boolean {
    return this.seededFromEnv;
  }

  /** Subscribe to hot-effect changes. Called after a successful write. */
  onChange(listener: (settings: RuntimeSettings) => void): void {
    this.listeners.push(listener);
  }

  update(patch: Record<string, unknown>): RuntimeSettings {
    const next = applySettingsPatch(this.current, patch);
    this.backup();
    this.current = next;
    this.persist();
    for (const listener of this.listeners) listener(this.get());
    return this.get();
  }

  private load(): { settings: RuntimeSettings; seededFromEnv: boolean } {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(this.path, "utf8"));
    } catch (cause) {
      throw new Error(
        `${this.path} is not valid JSON. Refusing to start rather than discard operator settings.`,
        { cause },
      );
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`${this.path} must contain a settings object`);
    }
    const file = parsed as Partial<SettingsFile>;
    if (file.version !== SETTINGS_VERSION) {
      throw new Error(
        `${this.path} has unsupported version ${String(file.version)}; expected ${SETTINGS_VERSION}`,
      );
    }
    if (!file.settings || typeof file.settings !== "object") {
      throw new Error(`${this.path} is missing its settings object`);
    }
    // Lenient on read: clamp out-of-range values instead of refusing to start.
    // Only structural damage (bad JSON, wrong version) fails closed.
    const settings = coerceStoredSettings(
      defaultRuntimeSettings(),
      file.settings as Record<string, unknown>,
    );
    return { settings, seededFromEnv: file.seeded_from_env === true };
  }

  private persist(): void {
    const file: SettingsFile = {
      version: SETTINGS_VERSION,
      seeded_from_env: this.seededFromEnv,
      updated_at: Date.now(),
      settings: this.current as unknown as Record<string, unknown>,
    };
    // Write to a temp path then rename, so a crash mid-write cannot truncate the
    // live file.
    const temp = `${this.path}.tmp-${process.pid}`;
    writeFileSync(temp, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
    renameSync(temp, this.path);
    try {
      chmodSync(this.path, 0o600);
    } catch {
      // best-effort on filesystems that ignore mode
    }
  }

  private backup(): void {
    if (!existsSync(this.path)) return;
    const target = join(this.dir(), `${BACKUP_PREFIX}${Date.now()}`);
    try {
      writeFileSync(target, readFileSync(this.path), { mode: 0o600 });
    } catch {
      return;
    }
    this.pruneBackups();
  }

  private pruneBackups(): void {
    const backups = readdirSync(this.dir())
      .filter((name) => name.startsWith(BACKUP_PREFIX))
      .sort();
    for (const stale of backups.slice(0, Math.max(0, backups.length - BACKUPS_KEPT))) {
      try {
        unlinkSync(join(this.dir(), stale));
      } catch {
        // a backup we cannot prune is not worth failing a write over
      }
    }
  }

  private dir(): string {
    return this.path.slice(0, this.path.lastIndexOf("/")) || ".";
  }
}

export { SettingsValidationError };
