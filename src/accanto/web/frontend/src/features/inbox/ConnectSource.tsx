import { useEffect, useState } from "react";
import { type BrowserSession, type UUID, loadResource } from "../../lib/api";
import {
  type TransactionProvider,
  type TransactionSource,
  browserCall,
  inbox,
} from "../../lib/inbox";
import { Wait } from "../../ui";
import { useLoad } from "../workspace/shared";

interface Plan {
  id: string;
  name: string;
  currency: string | null;
}
interface SourceAccount {
  id: string;
  name: string;
  type: string;
  on_budget: boolean;
  closed: boolean;
  selected: boolean;
}

/**
 * Connect a YNAB plan through the token saved in Settings, then choose its accounts. The token
 * never reaches this screen; the server reads it to list plans and accounts.
 */
export function ConnectSource({
  entityId,
  today,
  source,
  credentials,
  connected,
  openSettings,
}: {
  entityId: UUID;
  today: string;
  source?: TransactionSource;
  credentials: (signIn?: boolean) => Promise<BrowserSession>;
  /** Called with the source once its accounts are chosen, so the inbox can sync it. */
  connected: (source: TransactionSource) => void;
  openSettings?: () => void;
}) {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [plan, setPlan] = useState("");
  const [start, setStart] = useState(`${today.slice(0, 7)}-01`);
  const [accounts, setAccounts] = useState<SourceAccount[] | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [pendingSource, setPendingSource] = useState<TransactionSource | undefined>(source);
  const [busy, setBusy] = useState<string>("");
  const [error, setError] = useState("");
  const root = `/api/entities/${encodeURIComponent(entityId)}/sources`;
  const provider = useLoad(
    () => loadResource<TransactionProvider>(inbox.providerPath(entityId), () => false),
    [entityId],
  );
  const ready = provider.kind === "ready" && provider.data.configured;

  async function step(label: string, run: () => Promise<void>) {
    setBusy(label);
    setError("");
    try {
      await run();
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "That did not work. Try again.");
    } finally {
      setBusy("");
    }
  }
  const loadAccounts = (target: TransactionSource) =>
    step("Loading accounts…", async () => {
      const rows = await browserCall<SourceAccount[]>(
        credentials,
        `${root}/${target.id}/accounts`,
        "GET",
      );
      setAccounts(rows.filter((a) => !a.closed));
      setChosen(new Set(rows.filter((a) => a.selected).map((a) => a.id)));
    });
  const loadPlans = () =>
    step("Finding plans…", async () => {
      const found = await browserCall<Plan[]>(credentials, `${root}/ynab/plans`, "GET");
      setPlans(found);
      setPlan(found.find((p) => p.currency === "USD")?.id ?? "");
    });
  // Each step loads what it needs on arrival, so setup is choose-and-continue.
  // biome-ignore lint/correctness/useExhaustiveDependencies: Load once when the step opens.
  useEffect(() => {
    if (!ready) return;
    if (pendingSource) void loadAccounts(pendingSource);
    else void loadPlans();
  }, [ready]);

  const problem = error && (
    <p role="alert" className="bad-text">
      {error}
    </p>
  );
  const progress = busy && (
    <output className="note ix-busy">
      <span className="ix-spin" aria-hidden="true" /> {busy}
    </output>
  );

  if (provider.kind === "loading")
    return (
      <Wait>
        <output className="note">Loading…</output>
      </Wait>
    );
  if (!ready) {
    return (
      <div className="ix-connect card pad">
        <b>Connect YNAB</b>
        <p className="note">
          {"error" in provider
            ? `Could not check transaction settings. ${provider.error.message}`
            : "Add your YNAB personal access token in Settings → Transactions."}
        </p>
        {openSettings && (
          <button type="button" className="btn pri sm" onClick={openSettings}>
            Open Settings
          </button>
        )}
      </div>
    );
  }

  if (pendingSource) {
    const open = accounts ?? [];
    return (
      <div className="ix-connect card pad">
        <b>Choose which {pendingSource.name} accounts to import</b>
        {progress}
        {accounts && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void step("Saving accounts…", async () => {
                const saved = await browserCall<TransactionSource>(
                  credentials,
                  `${root}/${pendingSource.id}/accounts`,
                  "PUT",
                  { expected_revision: pendingSource.revision, account_ids: [...chosen] },
                );
                connected(saved);
              });
            }}
          >
            <fieldset disabled={Boolean(busy)} className="ix-accounts">
              <legend className="note">
                Import from {chosen.size} of {open.length} accounts
              </legend>
              <div className="ix-accounts-tools">
                <button
                  type="button"
                  className="btn quiet sm"
                  onClick={() => setChosen(new Set(open.map((a) => a.id)))}
                >
                  Choose all
                </button>
                <button type="button" className="btn quiet sm" onClick={() => setChosen(new Set())}>
                  Clear
                </button>
              </div>
              <div className="ix-accounts-list">
                {open.map((a) => (
                  <label key={a.id}>
                    <input
                      type="checkbox"
                      checked={chosen.has(a.id)}
                      onChange={(event) => {
                        const next = new Set(chosen);
                        if (event.target.checked) next.add(a.id);
                        else next.delete(a.id);
                        setChosen(next);
                      }}
                    />{" "}
                    {a.name} <small className="note">{a.on_budget ? a.type : "tracking"}</small>
                  </label>
                ))}
              </div>
              <div className="ix-accounts-do">
                <button type="submit" className="btn pri sm" disabled={!chosen.size}>
                  Import these accounts and sync
                </button>
              </div>
            </fieldset>
          </form>
        )}
        {problem}
        {!accounts && !busy && (
          <button type="button" className="btn sm" onClick={() => void loadAccounts(pendingSource)}>
            Load accounts again
          </button>
        )}
      </div>
    );
  }

  return (
    <form
      className="ix-connect card pad"
      onSubmit={(event) => {
        event.preventDefault();
        void step("Connecting…", async () => {
          const created = await browserCall<TransactionSource>(
            credentials,
            `${root}/ynab`,
            "POST",
            {
              plan_id: plan,
              start_date: start,
            },
          );
          setPendingSource(created);
          await loadAccounts(created);
        });
      }}
    >
      <b>Connect a YNAB plan</b>
      {progress}
      {plans && (
        <fieldset disabled={Boolean(busy)} className="ix-connect-fields">
          <label>
            <span>Plan</span>
            <select
              className="input"
              required
              value={plan}
              onChange={(event) => setPlan(event.target.value)}
            >
              <option value="">Choose a plan</option>
              {plans.map((p) => (
                <option key={p.id} value={p.id} disabled={p.currency !== "USD"}>
                  {p.name}
                  {p.currency !== "USD"
                    ? ` (${p.currency ?? "unknown currency"}, not supported)`
                    : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Import transactions from</span>
            <input
              className="input"
              type="date"
              required
              value={start}
              onChange={(event) => setStart(event.target.value)}
            />
          </label>
          <button type="submit" className="btn pri sm">
            Connect this plan
          </button>
        </fieldset>
      )}
      {problem}
      {!plans && !busy && (
        <button type="button" className="btn sm" onClick={() => void loadPlans()}>
          Find plans again
        </button>
      )}
    </form>
  );
}
