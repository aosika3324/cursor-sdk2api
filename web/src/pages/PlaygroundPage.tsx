import { protocolEndpoint } from "../api";
import { Button } from "../bflabs/Button";
import { Field } from "../bflabs/Field";
import { Select } from "../bflabs/Select";
import { Tabs } from "../bflabs/Tabs";
import { Textarea } from "../bflabs/Textarea";
import { hrefFor } from "../nav";
import { identityLabel, type RosterItem } from "../roster";
import { useI18n } from "../state/I18nContext";
import type { Protocol } from "../types";
import { PageFrame } from "./shared";

export function PlaygroundPage({
  roster,
  activeId,
  protocol,
  selectedModel,
  prompt,
  stream,
  output,
  runState,
  onActive,
  onProtocol,
  onModel,
  onPrompt,
  onStream,
  onRun,
}: {
  roster: RosterItem[];
  activeId: string;
  protocol: Protocol;
  selectedModel: string;
  prompt: string;
  stream: boolean;
  output: string;
  runState: string;
  onActive: (id: string) => void;
  onProtocol: (value: Protocol) => void;
  onModel: (value: string) => void;
  onPrompt: (value: string) => void;
  onStream: (value: boolean) => void;
  onRun: () => void;
}) {
  const t = useI18n().t.play;
  const active = roster.find((item) => item.id === activeId);
  const models = active?.models;

  return (
    <PageFrame title={t.title}>
      <Field className="page-field" label={t.pick}>
        <Select value={activeId} onChange={(event) => onActive(event.target.value)}>
          {roster.length === 0 ? <option value="">{t.waiting}</option> : null}
          {roster.map((item) => (
            <option key={item.id} value={item.id}>
              {identityLabel(item.account, item.keyHint)}
            </option>
          ))}
        </Select>
      </Field>
      {roster.length === 0 ? <p className="empty"><a href={hrefFor("accounts")}>{t.accounts}</a></p> : null}

      <Tabs
        className="bf-tabs--bare"
        label="Protocol"
        value={protocol}
        onValueChange={(value) => onProtocol(value as Protocol)}
        items={([
          { value: "messages", label: "Messages" },
          { value: "chat", label: "Chat" },
          { value: "responses", label: "Responses" },
        ] as const).map((item) => ({
          value: item.value,
          label: item.label,
          content: null,
        }))}
      />

      <form
        className="form page-form"
        onSubmit={(event) => {
          event.preventDefault();
          onRun();
        }}
      >
        <div className="meta">
          <code className="path">POST {protocolEndpoint(protocol)}</code>
          <div className="stream">
            <button type="button" className={stream ? "is-on" : ""} onClick={() => onStream(true)}>{t.stream}</button>
            <button type="button" className={!stream ? "is-on" : ""} onClick={() => onStream(false)}>JSON</button>
          </div>
        </div>
        <Field className="page-field" label="Model">
          <Select value={selectedModel} onChange={(event) => onModel(event.target.value)}>
            <option value="" disabled>{t.waiting}</option>
            {models?.data.map((model) => (
              <option key={model.id} value={model.id}>{model.display_name || model.id}</option>
            ))}
          </Select>
        </Field>
        <Field className="page-field" label={t.prompt}>
          <Textarea value={prompt} onChange={(event) => onPrompt(event.target.value)} />
        </Field>
        <div className="sendrow">
          <Button type="submit" variant="primary" size="sm" loading={runState === "loading"} disabled={!active || !selectedModel || runState === "loading"}>
            {runState === "loading" ? t.sending : t.send}
          </Button>
        </div>
      </form>
      <h2 className="subhead">{t.events}</h2>
      <pre className="out page-out">{output || t.emptyOutput}</pre>
    </PageFrame>
  );
}
