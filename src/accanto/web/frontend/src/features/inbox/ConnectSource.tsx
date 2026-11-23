import { useState } from "react";
import { ApiError, type BrowserSession, type UUID, fetchJson } from "../../lib/api";
import type { TransactionSource } from "../../lib/inbox";

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
 * Connect a YNAB plan and choose its accounts. The access token lives only in this form's state
 * and is posted once; it is never shown again, echoed by the server, or passed to an agent.
 */
export function ConnectSource({
  entityId,
  today,
  source,
  credentials,
  connected,
}: {
  entityId: UUID;
  today: string;
  source?: TransactionSource;
  credentials: (signIn?: boolean) => Promise<BrowserSession>;
  connected: () => void;
}) {
  const [token, setToken] = useState("");
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [plan, setPlan] = useState("");
  const [start, setStart] = useState(`${today.slice(0, 7)}-01`);
  const [accounts, setAccounts] = useState<SourceAccount[] | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [pendingSource, setPendingSource] = useState<TransactionSource | undefined>(source);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const root = `/api/entities/${encodeURIComponent(entityId)}/sources`;

  async function call<T>(path: string, method: string, body?: object): Promise<T> {
    const session = await credentials();
    const init = (s: BrowserSession): RequestInit => ({
      method,
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": s.csrf_token,
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    try {
      return await fetchJson<T>(path, method === "GET" ? {} : init(session));
    } catch (issue) {
      if (!(issue instanceof ApiError) || issue.kind !== "unauthenticated") throw issue;
      const again = await credentials(true);
      return await fetchJson<T>(path, method === "GET" ? {} : init(again));
    }
  }
  async function step(run: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await run();
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "That did not work. Try again.");
    } finally {
      setBusy(false);
    }
  }
  const loadAccounts = (target: TransactionSource) =>
    step(async () => {
      const rows = await call<SourceAccount[]>(`${root}/${target.id}/accounts`, "GET");
      setAccounts(rows.filter((a) => !a.closed));
      setChosen(new Set(rows.filter((a) => a.selected).map((a) => a.id)));
    });

  if (pendingSource) {
    return (
      <div className="ix-connect card pad">
        <b>Choose which {pendingSource.name} accounts to import</b>
        {accounts === null ? (
          <button
            type="button"
            className="btn sm"
            disabled={busy}
            onClick={() => void loadAccounts(pendingSource)}
          >
            Load accounts
          </button>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void step(async () => {
                await call(`${root}/${pendingSource.id}/accounts`, "PUT", {
                  expected_revision: pendingSource.revision,
                  account_ids: [...chosen],
                });
                connected();
              });
            }}
          >
            <fieldset disabled={busy} className="ix-accounts">
              <legend className="note">
                Nothing is imported from accounts you leave unchecked.
              </legend>
              {accounts.map((a) => (
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
              <button type="submit" className="btn pri sm" disabled={!chosen.size}>
                Import these accounts
              </button>
            </fieldset>
          </form>
        )}
        {error && (
          <p role="alert" className="bad-text">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <form
      className="ix-connect card pad"
      onSubmit={(event) => {
        event.preventDefault();
        if (plans === null) {
          void step(async () => {
            const found = await call<Plan[]>(`${root}/ynab/plans`, "POST", {
              access_token: token,
            });
            setPlans(found);
            setPlan(found.find((p) => p.currency === "USD")?.id ?? "");
          });
          return;
        }
        void step(async () => {
          const created = await call<TransactionSource>(`${root}/ynab`, "POST", {
            access_token: token,
            plan_id: plan,
            start_date: start,
          });
          setToken("");
          setPlans(null);
          setPendingSource(created);
          await loadAccounts(created);
        });
      }}
    >
      <b>Connect YNAB</b>
      <p className="note">
        Paste a YNAB personal access token. Accanto stores it encrypted, only reads transactions,
        and never shows it again or gives it to an assistant.
      </p>
      <fieldset disabled={busy} className="ix-connect-fields">
        <label>
          <span>YNAB access token</span>
          <input
            className="input"
            type="password"
            autoComplete="off"
            spellCheck={false}
            required
            minLength={10}
            value={token}
            onChange={(event) => {
              setToken(event.target.value);
              setPlans(null);
            }}
          />
        </label>
        {plans && (
          <>
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
          </>
        )}
        <button type="submit" className="btn pri sm">
          {plans ? "Connect this plan" : "Find plans"}
        </button>
      </fieldset>
      {error && (
        <p role="alert" className="bad-text">
          {error}
        </p>
      )}
    </form>
  );
}
