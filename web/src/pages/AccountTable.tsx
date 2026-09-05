import { Button } from "../bflabs/Button";
import { catalogHasFable5 } from "../fable5";
import { hrefFor } from "../nav";
import { formatGrokBotQuota, formatQuota, formatQuotaBreakdown } from "../quota";
import { identityLabel, type RosterItem } from "../roster";
import { ActionLink } from "./shared";

export interface AccountTableExtras {
  selected: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  onEdit: (id: string) => void;
  onProxy: (id: string) => void;
  onVerify: (id: string) => void;
  onDisable: (id: string, disabled: boolean) => void;
  labels: {
    edit: string;
    proxy: string;
    verify: string;
    enable: string;
    disable: string;
    disabledTag: string;
    priority: string;
    proxyDirect: string;
  };
}

export function AccountTable({
  items,
  quotaMissing,
  grokBotQuota,
  grokBotMissing,
  fableOn,
  fableOff,
  fableUnknown,
  testing,
  test,
  testFail,
  open,
  remove,
  headers,
  onTest,
  onRemove,
  extras,
}: {
  items: RosterItem[];
  quotaMissing: string;
  grokBotQuota: string;
  grokBotMissing: string;
  fableOn: string;
  fableOff: string;
  fableUnknown: string;
  testing: string;
  test: string;
  testFail: string;
  open: string;
  remove?: string;
  headers: [string, string, string, string];
  onTest: (id: string) => void;
  onRemove?: (id: string) => void;
  extras?: AccountTableExtras;
}) {
  const allSelected = Boolean(
    extras && items.length > 0 && items.every((item) => extras.selected.has(item.id)),
  );
  return (
    <div className="table-wrap">
      <table className="grid-table">
        <thead>
          <tr>
            {extras ? (
              <th className="col-select">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={extras.onToggleAll}
                  aria-label="select all"
                />
              </th>
            ) : null}
            {headers.map((label) => <th key={label}>{label}</th>)}
            <th></th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const quota = formatQuota(item.account);
            const quotaBreakdown = formatQuotaBreakdown(item.account);
            const grokQuota = formatGrokBotQuota(item.account);
            const fable = item.models ? (catalogHasFable5(item.models) ? fableOn : fableOff) : fableUnknown;
            const probe =
              item.testState === "testing"
                ? testing
                : item.testState === "pass"
                  ? `${item.testMs ?? 0} ms`
                  : item.testState === "fail"
                    ? item.testError || testFail
                    : "—";
            return (
              <tr key={item.id} className={item.disabled ? "row-disabled" : undefined}>
                {extras ? (
                  <td className="col-select">
                    <input
                      type="checkbox"
                      checked={extras.selected.has(item.id)}
                      onChange={() => extras.onToggle(item.id)}
                      aria-label={item.keyHint}
                    />
                  </td>
                ) : null}
                <td>
                  <a className="row-link" href={hrefFor("account", item.id)}>
                    <strong>{item.label || identityLabel(item.account, item.keyHint)}</strong>
                    <span className="sub">{item.account?.identity?.api_key_name || item.keyHint}</span>
                  </a>
                  {extras ? (
                    <span className="sub row-meta">
                      {item.disabled ? <em className="tag-off">{extras.labels.disabledTag}</em> : null}
                      <span>{extras.labels.priority} {item.priority ?? 100}</span>
                      <span>
                        {item.proxy?.configured
                          ? `${item.proxy.scheme}://${item.proxy.host}`
                          : extras.labels.proxyDirect}
                      </span>
                    </span>
                  ) : null}
                  {item.lastError ? <span className="sub row-error">{item.lastError.reason}</span> : null}
                </td>
                <td>
                  <span>{quota || quotaMissing}</span>
                  {quotaBreakdown ? <span className="sub quota-breakdown">{quotaBreakdown}</span> : null}
                  <span className="sub quota-breakdown">{grokBotQuota} {grokQuota || grokBotMissing}</span>
                </td>
                <td>{fable}</td>
                <td>{probe}</td>
                <td className="row-actions">
                  <div className="row-action-group">
                    <Button variant="secondary" size="sm" disabled={item.testState === "testing"} onClick={() => onTest(item.id)}>
                      {item.testState === "testing" ? testing : test}
                    </Button>
                    {extras ? (
                      <>
                        <Button variant="secondary" size="sm" onClick={() => extras.onVerify(item.id)}>
                          {extras.labels.verify}
                        </Button>
                        <Button variant="quiet" size="sm" onClick={() => extras.onEdit(item.id)}>
                          {extras.labels.edit}
                        </Button>
                        <Button variant="quiet" size="sm" onClick={() => extras.onProxy(item.id)}>
                          {extras.labels.proxy}
                        </Button>
                        <Button
                          variant="quiet"
                          size="sm"
                          onClick={() => extras.onDisable(item.id, !item.disabled)}
                        >
                          {item.disabled ? extras.labels.enable : extras.labels.disable}
                        </Button>
                      </>
                    ) : null}
                    <ActionLink href={hrefFor("account", item.id)}>{open}</ActionLink>
                    {onRemove && remove ? (
                      <Button variant="quiet" size="sm" onClick={() => onRemove(item.id)}>{remove}</Button>
                    ) : null}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
