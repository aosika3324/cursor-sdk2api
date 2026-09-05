import { AsyncLocalStorage } from "node:async_hooks";
import http from "node:http";
import https from "node:https";
import { ProxyAgent as NodeProxyAgent } from "proxy-agent";
import { ProxyAgent as UndiciProxyAgent, Socks5ProxyAgent, getGlobalDispatcher } from "undici";
import type { Dispatcher } from "undici";
import type { ProxyCredentials } from "./settings/schema.js";

export interface ProxyBinding {
  /** Redacted label for logs and health. Never the URL. */
  readonly id: string;
  readonly httpAgent: http.Agent;
  readonly httpsAgent: https.Agent;
  readonly dispatcher: Dispatcher;
}

interface AgentBundle {
  httpAgent: http.Agent;
  httpsAgent: https.Agent;
  dispatcher: Dispatcher;
}

const SOCKS_SCHEMES = new Set(["socks:", "socks4:", "socks5:", "socks5h:"]);

function withCredentials(proxy: ProxyCredentials): string {
  if (!proxy.username && !proxy.password) return proxy.url;
  const url = new URL(proxy.url);
  if (proxy.username) url.username = encodeURIComponent(proxy.username);
  if (proxy.password) url.password = encodeURIComponent(proxy.password);
  return url.toString();
}

/**
 * Per-account outbound proxy scoping.
 *
 * The official SDK uses Node's global http/https agents for Agent traffic and
 * undici's global dispatcher for fetch traffic (models.list, Dashboard usage).
 * Neither accepts a per-call transport, and the SDK's own
 * `setConnectTransportFactory` seam is not reachable through its exports map.
 *
 * So we scope below the SDK: an AsyncLocalStorage-backed getter on the global
 * agents returns the agent bound to the current async context, falling back to
 * the process default outside any context. Verified to isolate concurrent
 * contexts; socket pools are per-agent so connections never cross accounts.
 *
 * Installing the getter mutates a Node builtin, so it is opt-in. While disabled
 * nothing is patched and behavior is byte-for-byte what it was before.
 */
export class ProxyContext {
  private readonly storage = new AsyncLocalStorage<ProxyBinding>();
  private readonly cache = new Map<string, AgentBundle>();
  private installed = false;
  private fallbackHttp?: http.Agent;
  private fallbackHttps?: https.Agent;
  private fallbackDispatcher?: Dispatcher;

  /** Number of distinct proxies currently cached. Safe for /health. */
  boundProxyCount(): number {
    return this.cache.size;
  }

  isInstalled(): boolean {
    return this.installed;
  }

  /**
   * Patch the global agents. Idempotent. Call only when per-account proxying is
   * enabled; disabling requires a restart, which the settings schema documents.
   */
  install(): void {
    if (this.installed) return;
    this.fallbackHttp = http.globalAgent;
    this.fallbackHttps = https.globalAgent;
    this.fallbackDispatcher = getGlobalDispatcher();

    Object.defineProperty(http, "globalAgent", {
      configurable: true,
      get: () => this.storage.getStore()?.httpAgent ?? this.fallbackHttp,
      set: (value: http.Agent) => {
        this.fallbackHttp = value;
      },
    });
    Object.defineProperty(https, "globalAgent", {
      configurable: true,
      get: () => this.storage.getStore()?.httpsAgent ?? this.fallbackHttps,
      set: (value: https.Agent) => {
        this.fallbackHttps = value;
      },
    });
    this.installed = true;
  }

  /** Dispatcher for the current context, for the SDK's fetch path. */
  currentDispatcher(): Dispatcher | undefined {
    return this.storage.getStore()?.dispatcher ?? this.fallbackDispatcher;
  }

  bind(proxy: ProxyCredentials, id: string): ProxyBinding {
    const target = withCredentials(proxy);
    const cached = this.cache.get(target);
    const bundle = cached ?? this.createBundle(target);
    if (!cached) this.cache.set(target, bundle);
    return { id, ...bundle };
  }

  /** Run `fn` with `binding` as the active outbound proxy. */
  run<T>(binding: ProxyBinding | undefined, fn: () => T): T {
    if (!binding) return fn();
    return this.storage.run(binding, fn);
  }

  private createBundle(target: string): AgentBundle {
    const scheme = new URL(target).protocol;
    // proxy-agent picks the right implementation per scheme, including SOCKS.
    const httpAgent = new NodeProxyAgent({ getProxyForUrl: () => target }) as unknown as http.Agent;
    const httpsAgent = new NodeProxyAgent({ getProxyForUrl: () => target }) as unknown as https.Agent;
    const dispatcher = SOCKS_SCHEMES.has(scheme)
      ? new Socks5ProxyAgent(target)
      : new UndiciProxyAgent(target);
    return { httpAgent, httpsAgent, dispatcher };
  }
}
