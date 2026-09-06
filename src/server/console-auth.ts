import { randomBytes } from "node:crypto";

export const CONSOLE_COOKIE = "bf_console_session";
const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000;

export class ConsoleSessionStore {
  private sessions = new Map<string, number>(); // token -> expiresAt
  private ttlMs: number;

  constructor(ttlMs: number = DEFAULT_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  create(now: number = Date.now()): string {
    const token = randomBytes(24).toString("hex");
    this.sessions.set(token, now + this.ttlMs);
    return token;
  }

  validate(token: string, now: number = Date.now()): boolean {
    const expiresAt = this.sessions.get(token);
    if (expiresAt === undefined) return false;
    if (now >= expiresAt) {
      this.sessions.delete(token);
      return false;
    }
    return true;
  }

  destroy(token: string): void {
    this.sessions.delete(token);
  }
}

export function parseCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

export function serializeSessionCookie(
  token: string,
  opts: { secure: boolean; maxAge?: number },
): string {
  const parts = [`${CONSOLE_COOKIE}=${token}`, "HttpOnly", "SameSite=Strict", "Path=/"];
  if (opts.maxAge !== undefined) parts.push(`Max-Age=${opts.maxAge}`);
  if (opts.secure) parts.push("Secure");
  return parts.join("; ");
}
