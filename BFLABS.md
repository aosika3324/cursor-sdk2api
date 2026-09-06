# cursor-sdk2api Repository Rules

## Product contract

This is a public MIT gateway built on the official `@cursor/sdk`. Anthropic Messages, OpenAI Chat Completions, and OpenAI Responses must share one coordinator/session/replay engine through protocol-specific adapters.

- Cursor SDK is the only Cursor execution engine.
- The default runtime profile is `sdk`. `sand` is an explicit public v0.4 profile: it requires Grok Bot grant, a hash-guarded 1.0.30 loader, and isolated store/workspace. There is no SDK↔Sand auto-fallback.
- Cursor ambient shell, read, edit, and task remain disabled.
- Hosted `webSearch` / `webFetch` stay off unless `HOSTED_SEARCH_MODE=auto` and the client sends a bare live web_search tool. Filters, required/named choice, Chat `web_search_options`, and `x_search` stay fail closed.
- Client tools map to SDK custom tools/MCP and execute in the client workspace.
- Cursor and Grok Build are separate provider routes; do not claim native xAI `x_search` on this path.
- Unsupported hosted tools, stored responses, or continuation features must fail closed rather than lose semantics.

## Continuation and isolation invariants

- Sessions bind to the exact credential fingerprint, model, tool catalog, and pending tool-id batch.
- Duplicate different tool results fail closed.
- Cold recovery requires a complete transcript whose latest assistant tool batch matches the submitted results.
- Never blindly re-execute a completed external tool.
- The gateway is a trusted single-process sidecar, not a multi-tenant control plane.

## Sand direct-connect inference

- Sand (Grok Bot) profile inference does NOT go through `@cursor/sdk` — npm `1.0.30` ships no `InferenceService` binding. It connects directly to `https://api2.cursor.sh/aiserver.v1.InferenceService/Stream` via `src/sdk/sand-runtime.ts`.
- Auth uses the session-token JWT (extracted from a stored `user_...::<jwt>` session token), NOT the `crsr_` key. A `crsr_` key returns `ERROR_NOT_LOGGED_IN` on this endpoint.
- The `x-cursor-client-version` header must carry a `cli-` prefix (e.g. `cli-1.0.30`); a bare version is rejected with `ERROR_OUTDATED_CLIENT`.
- The hash-guarded patched SDK clone (`sand-loader.ts` / `sand-patch-contract.ts`) is retained but is NO LONGER used for inference — sand inference now goes direct. Accounts without a stored session token (no `sandJwt`) fall back to the clone path.
- Session tokens are persisted per-account (opt-in via `store_session_token` at onboarding), stored with the account file's `0o600` permissions, and never exposed via the public account API (only a `hasSessionToken` boolean).

## Security

Read `docs/SECURITY.md` before changing credentials, account pooling, state, logging, console, proxy, or continuation behavior.

- Never log API keys, cookies, prompts, thinking, tool schemas, arguments, or results.
- `STATE_DIR` is sensitive owner-only state.
- The management API and console must remain loopback-only unless an authenticated reverse proxy is explicitly designed and approved.
- Browser cookies, private Cursor HTTP protocols, and BeefAPI user tokens are forbidden.

## Source and verification

Use `README.md`, `docs/ARCHITECTURE.md`, `docs/PROTOCOL_COMPATIBILITY.md`, `docs/SECURITY.md`, and the nearest tests.

```bash
npm run typecheck
npm test
npm run build
npm run secret:scan
```

Live Cursor credentials, deployment, npm/GHCR publication, release, and production changes require separate authorization. Local contract tests do not prove live model behavior.

