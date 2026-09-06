import { useEffect, useMemo, useState } from "react";
import { runPrompt } from "./api";
import { go, hrefFor, readRoute, type Route } from "./nav";
import { RailNav } from "./RailNav";
import { AccountDetailPage } from "./pages/AccountDetailPage";
import { AccountsPage } from "./pages/AccountsPage";
import { ConnectPage } from "./pages/ConnectPage";
import { SettingsPage } from "./pages/SettingsPage";
import { QuotaDetail } from "./pages/QuotaDetail";
import type { RecipeName } from "./recipes";
import { HomePage } from "./pages/HomePage";
import { PlaygroundPage } from "./pages/PlaygroundPage";
import { QuotaPage } from "./pages/QuotaPage";
import { BFTheme } from "./bflabs/BFTheme";
import { Button } from "./bflabs/Button";
import { StatusTag } from "./bflabs/StatusTag";
import type { Protocol } from "./types";
import bfMarkUrl from "./assets/bf-mark.svg";
import { I18nProvider, useI18n, type Copy } from "./state/I18nContext";
import { AppStateProvider, useAppState } from "./state/AppStateContext";
import { AuthProvider, useAuthContext } from "./state/AuthContext";
import { LoginPage } from "./pages/LoginPage";

type LoadState = "idle" | "loading" | "ready" | "error";

export function App() {
  return (
    <I18nProvider>
      <AuthProvider>
        <AuthGate />
      </AuthProvider>
    </I18nProvider>
  );
}

function AuthGate() {
  const { authenticated, checkedSession, authEnforced } = useAuthContext();
  if (!checkedSession) return null;
  if (authEnforced && !authenticated) return <LoginPage />;
  return (
    <AppStateProvider>
      <AppInner />
    </AppStateProvider>
  );
}

function AppInner() {
  const { lang: language, setLang: setLanguage, t } = useI18n();
  const {
    health,
    healthError,
    refreshingHealth,
    refreshHealth,
    roster,
    activeId,
    active,
    selectedModel,
    draftKey,
    addError,
    adding,
    profileError,
    setActiveId,
    setSelectedModel,
    setDraftKey,
    testAccount,
    testAll,
    addAccount,
    onboardAccount,
    removeAccount,
    editAccount,
    editProxy,
    moveAccount,
    setAccountDisabled,
    verifyAccount,
    runBatch,
    setAccountProfile,
  } = useAppState();
  const [tone, setTone] = useState<"light" | "dark">("light");
  const [route, setRoute] = useState<Route>(readRoute);
  const [protocol, setProtocol] = useState<Protocol>("messages");
  const [prompt, setPrompt] = useState("Reply with a short status check for this gateway.");
  const [stream, setStream] = useState(true);
  const [output, setOutput] = useState("");
  const [runState, setRunState] = useState<LoadState>("idle");
  const [recipe, setRecipe] = useState<RecipeName>("claude");
  const [copied, setCopied] = useState("");
  const [quotaFor, setQuotaFor] = useState("");
  const origin = window.location.origin;

  useEffect(() => {
    const onHash = () => setRoute(readRoute());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
    document.title = `${t.product} · ${pageLabelFor(route.page, t)}`;
  }, [language, route.page, t]);

  const protocolSummary = useMemo(() => {
    if (!health) return "…";
    const supported = ["Messages"];
    if (health.capabilities.chat_completions === true) supported.push("Chat");
    if (health.capabilities.responses === true) supported.push("Responses");
    return supported.join(" + ");
  }, [health]);

  const snippets: Record<RecipeName, string> = {
    claude: `ANTHROPIC_BASE_URL=${origin}\nANTHROPIC_AUTH_TOKEN=<gateway-key>\nANTHROPIC_MODEL=claude-sonnet-4-6\nclaude`,
    grok: `[models]\ndefault = "cursor-gw"\n\n[model.cursor-gw]\nname = "cursor-sdk2api"\nbase_url = "${origin}/v1"\napi_key = "<gateway-key>"\nmodel = "grok-4.6"\napi_backend = "responses"\n\n# Isolated: GROK_HOME=/path/to/grok_home grok --model cursor-gw`,
    openai: `from openai import OpenAI\nclient = OpenAI(base_url="${origin}/v1", api_key="<gateway-key>")`,
    newapi: `Base URL: ${origin}\nAPI key: <gateway-key>\nAnthropic upstream: ${origin}\nOpenAI upstream: ${origin}/v1`,
  };
  const clientRoutes = language === "zh"
    ? [
        { client: "Claude Code", endpoint: "POST /v1/messages", note: "ANTHROPIC_BASE_URL，不要走 Chat" },
        { client: "Grok Build", endpoint: "POST /v1/responses", note: "api_backend=responses；若带 previous_response_id 被 422，再退回 chat_completions" },
        { client: "OpenAI SDK", endpoint: "POST /v1/chat/completions", note: "base_url 指到 /v1" },
        { client: "new-api", endpoint: "/v1/messages 或 /v1/chat/completions", note: "按上游类型选 Anthropic 或 OpenAI" },
      ]
    : [
        { client: "Claude Code", endpoint: "POST /v1/messages", note: "ANTHROPIC_BASE_URL. Do not use Chat." },
        { client: "Grok Build", endpoint: "POST /v1/responses", note: "api_backend=responses. If previous_response_id returns 422, fall back to chat_completions." },
        { client: "OpenAI SDK", endpoint: "POST /v1/chat/completions", note: "Point base_url at /v1." },
        { client: "new-api", endpoint: "/v1/messages or /v1/chat/completions", note: "Pick Anthropic or OpenAI to match the upstream type." },
      ];

  const run = async () => {
    if (!active || !selectedModel || !prompt.trim()) return;
    setRunState("loading");
    setOutput("");
    try {
      await runPrompt({
        accountId: active.id,
        protocol,
        model: selectedModel,
        prompt: prompt.trim(),
        stream,
        onChunk: setOutput,
      });
      setRunState("ready");
    } catch (error) {
      setOutput(messageOf(error));
      setRunState("error");
    }
  };

  const copyValue = async (label: string, value: string) => {
    try {
      await copyText(value);
      setCopied(label);
      window.setTimeout(() => setCopied(""), 1400);
    } catch {
      setCopied("");
    }
  };

  const healthOk = health?.status === "ok";

  const pageLabel = pageLabelFor(route.page, t);

  return (
    <BFTheme className="cpa-shell" tone={tone}>
      <a className="skip-link" href="#main-content">{t.skip}</a>
      <aside className="rail">
        <a className="brand" href={hrefFor("home")} aria-label={`${t.product} · ${t.consoleTag}`}>
          <BfMark />
          <span className="brand-text">
            <span className="brand-name">{t.product}</span>
            <span className="brand-prod">{t.consoleTag}</span>
          </span>
        </a>
        <RailNav
          page={route.page}
          operateLabel={t.groupOperate}
          gatewayLabel={t.groupGateway}
          home={t.navHome}
          quota={t.navQuota}
          accounts={t.navAccounts}
          connect={t.navStart}
          playground={t.navPlay}
          settings={t.navSettings}
          homeMeta={t.navHomeMeta}
          quotaMeta={t.navQuotaMeta}
          accountsMeta={t.navAccountsMeta}
          startMeta={t.navStartMeta}
          playMeta={t.navPlayMeta}
          settingsMeta={t.navSettingsMeta}
          accountCount={roster.length}
          icons={{
            home: <NavIcon name="home" />,
            quota: <NavIcon name="quota" />,
            key: <NavIcon name="key" />,
            start: <NavIcon name="start" />,
            play: <NavIcon name="play" />,
          }}
        />
        <div className="rail-foot">
          <StatusTag tone={healthOk ? "success" : healthError ? "danger" : "progress"}>{healthOk ? t.ready : healthError ? t.unavailable : t.loading}</StatusTag>
          <div className="rail-tools">
            <Button variant="quiet" size="sm" onClick={() => setLanguage(language === "en" ? "zh" : "en")}>{t.language}</Button>
            <Button variant="quiet" size="sm" onClick={() => setTone(tone === "light" ? "dark" : "light")}>{tone === "light" ? t.dark : t.light}</Button>
          </div>
        </div>
      </aside>
      <div className="stage">
      <header className="stage-bar">
        <p className="stage-title">
          {pageLabel}
          {copied ? <span className="copy-toast" role="status">{t.home.copied}</span> : null}
        </p>
        <nav className="links">
          <a href="https://github.com/Sunnyender-org/cursor-sdk2api" target="_blank" rel="noreferrer">{t.source}</a>
          <a href="https://github.com/Sunnyender-org/cursor-sdk2api/blob/main/docs/SECURITY.md" target="_blank" rel="noreferrer">{t.security}</a>
        </nav>
      </header>
      <main id="main-content">
        {route.page === "home" ? (
          <HomePage
            origin={origin}
            copied={copied}
            ready={healthOk ? t.ready : healthError ? t.unavailable : t.loading}
            readyOk={healthOk}
            sdk={health?.sdk_version ?? "…"}
            version={health?.version ?? "…"}
            instance={health?.instance_id ?? "…"}
            network={health ? (health.network.proxy_configured ? t.proxy : t.direct) : "…"}
            refreshing={refreshingHealth}
            roster={roster}
            onCopy={copyValue}
            onRefresh={() => void refreshHealth()}
          />
        ) : null}
        {route.page === "quota" ? (
          <QuotaPage roster={roster} onTest={(id) => void testAccount(id)} onTestAll={() => void testAll()} />
        ) : null}
        {route.page === "accounts" ? (
          <AccountsPage
            draftKey={draftKey}
            addError={addError}
            adding={adding}
            roster={roster}
            onDraft={setDraftKey}
            onAdd={() => void addAccount()}
            onTest={(id) => void testAccount(id)}
            onRemove={(id) => void removeAccount(id)}
            onEdit={(id) => void editAccount(id)}
            onProxy={(id) => void editProxy(id)}
            onVerify={(id) => void verifyAccount(id)}
            onDisable={(id, disabled) => void setAccountDisabled(id, disabled)}
            onBatch={(input) => void runBatch(input)}
            onMove={(id, direction) => void moveAccount(id, direction)}
            onQuota={setQuotaFor}
            onOnboard={(token, f5, bot) => void onboardAccount(token, f5, bot)}
            onboarding={adding}
          />
        ) : null}
        {route.page === "account" ? (
          <AccountDetailPage
            item={roster.find((item) => item.id === route.accountId)}
            onTest={(id) => void testAccount(id)}
            onUse={(id) => {
              setActiveId(id);
              go("playground");
            }}
            onProfile={(id, profile) => void setAccountProfile(id, profile)}
            profileError={profileError}
          />
        ) : null}
        {route.page === "playground" ? (
          <PlaygroundPage
            roster={roster}
            activeId={activeId}
            protocol={protocol}
            selectedModel={selectedModel}
            prompt={prompt}
            stream={stream}
            output={output}
            runState={runState}
            onActive={setActiveId}
            onProtocol={setProtocol}
            onModel={setSelectedModel}
            onPrompt={setPrompt}
            onStream={setStream}
            onRun={() => void run()}
          />
        ) : null}
        {route.page === "connect" ? (
          <ConnectPage origin={origin} copied={copied} recipe={recipe} snippets={snippets} routes={clientRoutes} onCopy={copyValue} onRecipe={setRecipe} />
        ) : null}
        {route.page === "settings" ? <SettingsPage /> : null}
      </main>
      {quotaFor ? (
        <QuotaDetail
          account={roster.find((item) => item.id === quotaFor)?.account}
          keyHint={roster.find((item) => item.id === quotaFor)?.keyHint ?? ""}
          onClose={() => setQuotaFor("")}
        />
      ) : null}
      <footer className="foot">
        <span>BF Labs · MIT · {protocolSummary}</span>
        <span className="foot-origin mono">{origin}</span>
      </footer>
      </div>
    </BFTheme>
  );
}

function pageLabelFor(page: Route["page"], t: Copy): string {
  if (page === "connect") return t.navStart;
  if (page === "accounts" || page === "account") return t.navAccounts;
  if (page === "quota") return t.navQuota;
  if (page === "playground") return t.navPlay;
  if (page === "settings") return t.navSettings;
  return t.navHome;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed";
}

function NavIcon({ name }: { name: "home" | "quota" | "key" | "start" | "play" }) {
  const d =
    name === "home"
      ? "M3 10.5 12 3l9 7.5V21H14V14H10v7H3Z"
      : name === "quota"
        ? "M12 3a9 9 0 1 0 9 9h-4a5 5 0 1 1-5-5V3Zm1 1.1V11h6.9A8 8 0 0 0 13 4.1Z"
        : name === "key"
          ? "M8 14a5 5 0 1 1 4.9-6H21v3h-2v3h-3v2h-3.1A5 5 0 0 1 8 14Zm0-3a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"
          : name === "start"
            ? "M8 5v14l11-7Z"
            : "M4 5h10v4H8v6h6v4H4Zm12 3 5 4-5 4Z";
  return (
    <svg className="nav-ico" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path fill="currentColor" d={d} />
    </svg>
  );
}

function BfMark() {
  return <img className="mark" aria-hidden="true" src={bfMarkUrl} alt="" />;
}

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const input = document.createElement("textarea");
  input.value = value;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.append(input);
  input.select();
  const copied = document.execCommand("copy");
  input.remove();
  if (!copied) throw new Error("Copy failed");
}
