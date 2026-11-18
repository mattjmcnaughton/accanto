import { Fragment, useEffect, useRef, useState } from "react";
import type { LoadState } from "../../lib/api";
import { balances } from "../../lib/balances";
import { destinations } from "../../lib/destinations";
import { monthly, type PlanGroup, type PlanRevision } from "../../lib/monthly";
import { confirmInAppNavigation } from "../../lib/recoverableWrite";
import { savings } from "../../lib/savings";
import { parseTimestamp } from "../../lib/timestamp";
import { LoadMessage, type ScreenProps, composing, useLoad } from "./shared";
import { CopyPlan } from "./PlanScenarios";
import { PlanWorksheet } from "./PlanWorksheet";
import {
  type Catalog,
  type WorksheetDraft,
  money,
  planInput,
  revisionLines,
  storedTotals,
  totals,
  versionLabel,
} from "./planWorksheetModel";
import "./planning.css";

type OpenDraft = { revision: PlanRevision; input?: WorksheetDraft; generation: number };
const changed = (draft: OpenDraft | undefined) =>
  !!draft?.input &&
  (draft.input.editing ||
    JSON.stringify({ name: draft.input.name, lines: draft.input.lines }) !==
      JSON.stringify({ name: draft.revision.name, lines: revisionLines(draft.revision) }));

export function Plans(
  p: ScreenProps & {
    home?: boolean;
    visible?: boolean;
    showPlans?: () => void;
    retainedDirty?: (value: boolean) => void;
  },
) {
  const [reload, setReload] = useState(0);
  const state = useLoad(() => monthly.plans(p.entity.id), [p.entity.id, p.refresh, reload]);
  const accounts = useLoad(() => savings.list(p.entity.id), [p.entity.id, p.refresh, reload]);
  const investments = useLoad(
    () => destinations.list(p.entity.id, "investment"),
    [p.entity.id, p.refresh, reload],
  );
  const giving = useLoad(
    () => destinations.list(p.entity.id, "giving"),
    [p.entity.id, p.refresh, reload],
  );
  const loans = useLoad(() => balances.loans(p.entity.id), [p.entity.id, p.refresh, reload]);
  const [opened, setOpened] = useState<Record<string, OpenDraft>>({});
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    if (p.home) setActive(null);
  }, [p.home]);
  const [creating, setCreating] = useState(false);
  const [copying, setCopying] = useState(false);
  const [name, setName] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [mode, setMode] = useState("NORMAL");
  const [confirmed, setConfirmed] = useState<Record<string, PlanGroup>>({});
  const help = useRef<HTMLDialogElement>(null);
  const helpOrigin = useRef<HTMLElement | null>(null);
  const gTime = useRef(0);
  const root = useRef<HTMLDivElement>(null);
  const hasChanges = !!name || Object.values(opened).some(changed);
  const reportDirty = useRef(p.retainedDirty ?? p.dirty);
  reportDirty.current = p.retainedDirty ?? p.dirty;
  useEffect(() => {
    reportDirty.current(hasChanges);
  }, [hasChanges]);
  const groups = state.kind === "ready" ? state.data : [];
  // Confirmed responses bridge the reload, but never override a newer server revision.
  const plans = [
    ...groups.map((plan) => {
      const local = confirmed[plan.plan_id];
      const localDraft = local?.revisions.find((r) => !r.saved);
      const remoteDraft = plan.revisions.find((r) => !r.saved);
      return localDraft &&
        remoteDraft &&
        (localDraft.number > remoteDraft.number ||
          (localDraft.number === remoteDraft.number && localDraft.revision > remoteDraft.revision))
        ? local
        : plan;
    }),
    ...Object.values(confirmed).filter(
      (plan) => !groups.some((item) => item.plan_id === plan.plan_id),
    ),
  ];
  const catalog: Catalog = {
    funding:
      accounts.kind === "ready"
        ? accounts.data.map((a) => ({ id: a.uuid, name: a.name, active: a.active }))
        : [],
    saving:
      accounts.kind === "ready"
        ? accounts.data.flatMap((a) =>
            (a.goals ?? []).map((g) => ({
              id: g.uuid,
              name: `${a.name} · ${g.name}`,
              active: a.active && g.active,
            })),
          )
        : [],
    investing:
      investments.kind === "ready"
        ? investments.data.map((d) => ({ id: d.uuid, name: d.name, active: d.active }))
        : [],
    giving:
      giving.kind === "ready"
        ? giving.data.map((d) => ({ id: d.uuid, name: d.name, active: d.active }))
        : [],
  };
  const unknown = (state: LoadState<unknown>) => state.kind !== "ready" && state.kind !== "empty";
  const unavailable = [
    ...(unknown(accounts) ? (["funding", "saving"] as const) : []),
    ...(unknown(investments) ? (["investing"] as const) : []),
    ...(unknown(giving) ? (["giving"] as const) : []),
    ...(unknown(loans) ? (["loans"] as const) : []),
  ];
  const draftOf = (plan: PlanGroup) => plan.revisions.find((r) => !r.saved);
  plans.sort(
    (a, b) =>
      (parseTimestamp(draftOf(b)?.updated_at) ?? 0) -
        (parseTimestamp(draftOf(a)?.updated_at) ?? 0) || a.plan_id.localeCompare(b.plan_id),
  );
  const updated = (plan: PlanGroup) => {
    const value = parseTimestamp(draftOf(plan)?.updated_at);
    return value !== null
      ? new Intl.DateTimeFormat("en-US", {
          timeZone: p.entity.time_zone,
          month: "short",
          day: "numeric",
          year: "numeric",
        }).format(new Date(value))
      : "Unknown";
  };
  const displayName = (plan: PlanGroup) =>
    opened[plan.plan_id]?.input?.name ??
    draftOf(plan)?.name ??
    plan.revisions[0]?.name ??
    "Unavailable Plan";
  const versionsOf = (plan: PlanGroup) =>
    plan.revisions.filter((r) => r.saved).sort((a, b) => a.number - b.number);
  const focus = (selector: string) =>
    requestAnimationFrame(() => root.current?.querySelector<HTMLElement>(selector)?.focus());
  function open(plan: PlanGroup) {
    if (p.busy) return;
    const revision = draftOf(plan);
    if (!revision) return;
    if (copying && !p.guard()) return;
    if (copying) p.dirty(false);
    setOpened((current) => ({
      ...current,
      [plan.plan_id]: current[plan.plan_id] ?? { revision, generation: 0 },
    }));
    setActive(plan.plan_id);
    setCopying(false);
    p.showPlans?.();
    focus(`[data-plan="${plan.plan_id}"] #rename-plan`);
  }
  function newPlan() {
    if (p.busy) return;
    if (copying && !p.guard()) return;
    if (copying) p.dirty(false);
    setActive(null);
    setCopying(false);
    setCreating(true);
    p.showPlans?.();
    focus("#new-plan-name");
  }
  function accepted(id: string, revision: PlanRevision, version?: PlanRevision) {
    setConfirmed((current) => ({
      ...current,
      [id]: {
        plan_id: id,
        revisions: [
          ...(plans.find((plan) => plan.plan_id === id)?.revisions.filter((r) => r.saved) ?? []),
          ...(version ? [version] : []),
          revision,
        ],
      },
    }));
    setOpened((current) => ({
      ...current,
      [id]: { revision, generation: (current[id]?.generation ?? 0) + 1 },
    }));
    setActive(id);
    setCopying(false);
    setCreating(false);
    setName("");
  }
  function showHelp() {
    helpOrigin.current = document.activeElement as HTMLElement;
    help.current?.showModal();
  }
  function keys(event: React.KeyboardEvent<HTMLTableElement>) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const button = (event.target as HTMLElement).closest("button");
    if (!button) return;
    const rows = Array.from(
      event.currentTarget.querySelectorAll<HTMLTableRowElement>("tbody tr"),
    ).filter((row) => row.querySelector("button"));
    const currentRow = button.closest("tr");
    if (!currentRow) return;
    let row = rows.indexOf(currentRow);
    let col = Array.from(rows[row].querySelectorAll("button")).indexOf(button);
    if (["j", "ArrowDown"].includes(event.key)) row = Math.min(rows.length - 1, row + 1);
    else if (["k", "ArrowUp"].includes(event.key)) row = Math.max(0, row - 1);
    else if (["h", "ArrowLeft", "0", "Home"].includes(event.key)) col = 0;
    else if (["l", "ArrowRight", "$", "End"].includes(event.key))
      col = rows[row].querySelectorAll("button").length - 1;
    else if (event.key === "G") row = rows.length - 1;
    else if (event.key === "g") {
      if (Date.now() - gTime.current < 600) row = 0;
      gTime.current = Date.now();
    } else if (event.key === "i") {
      event.preventDefault();
      button.click();
      return;
    } else if (event.key === "Escape") {
      setExpanded(null);
      return;
    } else return;
    if (event.key !== "g") gTime.current = 0;
    event.preventDefault();
    const buttons = rows[row].querySelectorAll("button");
    buttons[Math.min(col, buttons.length - 1)].focus();
  }
  if (p.concealed || p.visible === false) return null;
  const home = !!p.home;
  const visible = plans.filter((plan) =>
    displayName(plan).toLowerCase().includes(query.trim().toLowerCase()),
  );
  const continuation = plans.slice(0, 3);
  const attention = plans.flatMap((plan) => {
    const local = opened[plan.plan_id];
    const dirty = changed(local);
    const revision = draftOf(plan);
    const stats =
      dirty && local?.input
        ? local.input.editing
          ? { funding: null, allocated: null, unassigned: null }
          : totals(local.input.lines)
        : revision
          ? storedTotals(revision)
          : { funding: null, allocated: null, unassigned: null };
    return dirty || (stats.unassigned !== null && stats.unassigned < 0)
      ? [{ plan, dirty, stats }]
      : [];
  });
  return (
    <div
      className="planning"
      ref={root}
      onFocus={(event) =>
        setMode(
          event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement
            ? "INSERT"
            : "NORMAL",
        )
      }
      onKeyDown={(event) => {
        if (
          (!home && active) ||
          event.ctrlKey ||
          event.metaKey ||
          event.altKey ||
          help.current?.open ||
          (event.target as HTMLElement).closest("input,select,textarea")
        )
          return;
        if (event.key === "?") {
          event.preventDefault();
          showHelp();
        }
        if (event.key === "a" || event.key === "A") {
          event.preventDefault();
          newPlan();
        }
        if (event.key === "/" && !home) {
          event.preventDefault();
          focus("#plan-search");
        }
      }}
    >
      <LoadMessage state={state} retry={() => setReload((n) => n + 1)} />
      {(state.kind === "ready" || state.kind === "empty") && (
        <div hidden={!home} id="home">
          <div id="home-heading">
            <h1>{plans.length ? "Home" : "Welcome to Accanto"}</h1>
            {!!plans.length && (
              <button type="button" onClick={newPlan}>
                New Plan <kbd>A</kbd>
              </button>
            )}
          </div>
          {!plans.length ? (
            <section id="home-start">
              <h2>No Plans yet</h2>
              <button type="button" id="home-create" className="primary" onClick={newPlan}>
                Create your first Plan
              </button>
            </section>
          ) : (
            <>
              <section className="home-section">
                <div className="home-section-heading">
                  <h2>Continue working</h2>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => {
                      setActive(null);
                      p.showPlans?.();
                    }}
                  >
                    All Plans ({plans.length})
                  </button>
                </div>
                <div className="home-table-scroll">
                  <table aria-label="Continue working" onKeyDown={keys}>
                    <thead>
                      <tr>
                        <th>Plan</th>
                        <th>Draft</th>
                        <th>Updated</th>
                      </tr>
                    </thead>
                    <tbody>
                      {continuation.map((plan) => {
                        return (
                          <tr key={plan.plan_id}>
                            <td>
                              <button
                                type="button"
                                className="plan-open"
                                onClick={() => open(plan)}
                              >
                                {displayName(plan)}
                              </button>
                            </td>
                            <td>
                              {changed(opened[plan.plan_id])
                                ? "Unsaved changes in this tab"
                                : "Saved draft"}
                            </td>
                            <td>{updated(plan)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
              <section className="home-section">
                <div className="home-section-heading">
                  <h2>
                    Plan attention <span className="count">{attention.length}</span>
                  </h2>
                  <span>Current drafts</span>
                </div>
                {attention.length ? (
                  <div className="home-table-scroll">
                    <table aria-label="Plan attention" onKeyDown={keys}>
                      <thead>
                        <tr>
                          <th>Plan</th>
                          <th>What to revisit</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {attention.map(({ plan, dirty, stats }) => (
                          <Fragment key={plan.plan_id}>
                            <tr>
                              <td>{displayName(plan)}</td>
                              <td>
                                <button
                                  type="button"
                                  className="attention-reason text-button"
                                  aria-expanded={expanded === plan.plan_id}
                                  onClick={() =>
                                    setExpanded(expanded === plan.plan_id ? null : plan.plan_id)
                                  }
                                >
                                  {stats.unassigned !== null && stats.unassigned < 0
                                    ? `${money(-stats.unassigned)} overallocated`
                                    : "Unsaved draft changes"}{" "}
                                  {expanded === plan.plan_id ? "−" : "+"}
                                </button>
                              </td>
                              <td>
                                <button
                                  type="button"
                                  className="text-button"
                                  onClick={() => open(plan)}
                                >
                                  Open draft
                                </button>
                              </td>
                            </tr>
                            {expanded === plan.plan_id && (
                              <tr className="home-explanation">
                                <td colSpan={3}>
                                  {stats.unassigned !== null && stats.unassigned < 0 && (
                                    <p>
                                      Monthly funding <strong>{money(stats.funding)}</strong> −
                                      allocations <strong>{money(stats.allocated)}</strong> =
                                      unassigned <strong>{money(stats.unassigned)}</strong>.
                                    </p>
                                  )}
                                  {dirty && <p>Unsaved changes in this tab.</p>}
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p id="home-clear">No reported Plan attention items.</p>
                )}
              </section>
            </>
          )}
        </div>
      )}
      <div hidden={home || !!active} id="plans-index">
        <div id="plans-heading">
          <h1>
            Plans <span className="count">{plans.length}</span>
          </h1>
          <div>
            <button
              type="button"
              className="text-button"
              disabled={p.busy || !plans.length}
              onClick={() => {
                setCopying(true);
                setCreating(false);
              }}
            >
              Copy Plan
            </button>
            <button
              type="button"
              id="new-plan"
              className="primary"
              disabled={p.busy}
              onClick={newPlan}
            >
              New Plan <kbd>A</kbd>
            </button>
          </div>
        </div>
        {creating && (
          <form
            id="plan-create"
            onSubmit={(event) => {
              event.preventDefault();
              if (!name.trim()) {
                setInvalid(true);
                return;
              }
              p.save(
                monthly.createPlan(p.entity.id, {
                  name: name.trim(),
                  incomes: [{ name: "Net income", amount: "0.00" }],
                  fixed_costs: [],
                  spending: "0.00",
                  savings_funding: [],
                  saving_goals: [],
                  investments: [],
                  giving: [],
                }),
                (result) => accepted(result.plan_id, result.draft),
              );
            }}
          >
            <fieldset disabled={p.busy}>
              <label htmlFor="new-plan-name">Plan name</label>
              <input
                id="new-plan-name"
                maxLength={120}
                value={name}
                aria-invalid={invalid}
                onChange={(event) => {
                  setName(event.target.value);
                  setInvalid(false);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape" && !composing(event)) {
                    event.preventDefault();
                    if (!name.trim()) setInvalid(true);
                    else focus("#create-plan");
                  }
                }}
              />
              {invalid && (
                <p role="alert" className="field-error">
                  Enter a Plan name.
                </p>
              )}
              <button type="submit" id="create-plan" className="primary">
                Create and open
              </button>
              <button
                type="button"
                onClick={() => {
                  setCreating(false);
                  focus("#new-plan");
                }}
              >
                Cancel
              </button>
            </fieldset>
          </form>
        )}
        {copying && <CopyPlan plans={plans} screen={p} copied={accepted} />}
        <div id="plans-controls">
          <label className="sr-only" htmlFor="plan-search">
            Find a Plan
          </label>
          <input
            id="plan-search"
            placeholder="Find a Plan…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") focus(".plan-open");
            }}
          />
          <button type="button" className="text-button" onClick={showHelp}>
            Keyboard shortcuts <kbd>?</kbd>
          </button>
        </div>
        <div className="plans-table-scroll">
          <table aria-label="Plans" onKeyDown={keys}>
            <thead>
              <tr>
                <th>Plan</th>
                <th>Draft updated</th>
                <th>Latest saved version</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((plan) => {
                const versions = versionsOf(plan);
                return (
                  <Fragment key={plan.plan_id}>
                    <tr>
                      <td>
                        <button
                          type="button"
                          className="plan-open"
                          disabled={p.busy}
                          onClick={() => open(plan)}
                        >
                          {displayName(plan)}
                        </button>
                      </td>
                      <td>
                        {changed(opened[plan.plan_id]) ? "Unsaved changes · " : ""}
                        {updated(plan)}
                      </td>
                      <td>
                        {versions.length
                          ? versionLabel(
                              versions[versions.length - 1],
                              versions,
                              p.entity.time_zone,
                            )
                          : "No saved versions"}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="text-button"
                          aria-label={`Details for ${displayName(plan)}`}
                          aria-expanded={expanded === plan.plan_id}
                          onClick={() =>
                            setExpanded(expanded === plan.plan_id ? null : plan.plan_id)
                          }
                        >
                          Details {expanded === plan.plan_id ? "−" : "+"}
                        </button>
                      </td>
                    </tr>
                    {expanded === plan.plan_id && (
                      <tr className="plan-expanded">
                        <td colSpan={4}>
                          {versions.length} saved versions
                          {versions.map((version) => (
                            <p key={version.uuid}>
                              {versionLabel(version, versions, p.entity.time_zone)} · {version.name}
                            </p>
                          ))}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        {(state.kind === "ready" || state.kind === "empty") && !visible.length && (
          <div id="plans-empty">
            <h2>{plans.length ? "No matching Plans" : "No Plans yet"}</h2>
            <button type="button" onClick={plans.length ? () => setQuery("") : newPlan}>
              {plans.length ? "Clear search" : "Create your first Plan"}
            </button>
          </div>
        )}
      </div>
      {Object.entries(opened)
        .filter(([id]) => id === active)
        .map(([id, local]) => {
          const plan = plans.find((plan) => plan.plan_id === id);
          const current = plan && draftOf(plan);
          return (
            <div key={id} data-plan={id} hidden={home || active !== id}>
              {current &&
                (current.uuid !== local.revision.uuid ||
                  current.revision !== local.revision.revision) && (
                  <div role="alert">
                    <p>The stored draft changed. Your attempted input is retained.</p>
                    <button
                      type="button"
                      disabled={p.busy}
                      onClick={() => {
                        if (!changed(local) || confirmInAppNavigation(() => true))
                          setOpened((all) => ({
                            ...all,
                            [id]: { revision: current, generation: local.generation + 1 },
                          }));
                      }}
                    >
                      Reload current draft
                    </button>
                  </div>
                )}
              {[
                { name: "Savings accounts and goals", state: accounts },
                { name: "Investments", state: investments },
                { name: "Giving recipients", state: giving },
                { name: "Loan accounts", state: loans },
              ].map((item) =>
                item.state.kind === "ready" || item.state.kind === "empty" ? null : (
                  <div key={item.name}>
                    <p>{item.name}</p>
                    <LoadMessage state={item.state} retry={() => setReload((n) => n + 1)} />
                  </div>
                ),
              )}
              <PlanWorksheet
                key={local.generation}
                revision={local.revision}
                retained={local.input}
                versions={plan ? versionsOf(plan) : []}
                catalog={catalog}
                unavailable={unavailable}
                loans={
                  loans.kind === "ready"
                    ? loans.data.map((loan) => ({
                        id: loan.uuid,
                        name: loan.name,
                        active: loan.active,
                      }))
                    : []
                }
                busy={p.busy}
                timeZone={p.entity.time_zone}
                onBack={() => setActive(null)}
                onChange={(input) => setOpened((all) => ({ ...all, [id]: { ...all[id], input } }))}
                onSave={(title, lines) =>
                  p.save(
                    monthly.editPlan(
                      p.entity.id,
                      id,
                      planInput(title, lines, local.revision.revision),
                    ),
                    (result) => accepted(id, result.draft),
                  )
                }
                onVersion={() =>
                  p.save(
                    monthly.saveVersion(p.entity.id, id, {
                      expected_revision: local.revision.revision,
                    }),
                    (result) => accepted(id, result.draft, result.version),
                  )
                }
              />
            </div>
          );
        })}
      {(home || !active) && (
        <footer id="keyboard-status">
          <span className="mode">{mode}</span>
          <span className="key-hints">
            <kbd>j k</kbd> move <kbd>Enter</kbd> open <kbd>A</kbd> new Plan
          </span>
          <button type="button" className="text-button" onClick={showHelp}>
            Keyboard shortcuts <kbd>?</kbd>
          </button>
        </footer>
      )}
      <dialog ref={help} onClose={() => helpOrigin.current?.focus()}>
        <div className="dialog-heading">
          <h2>Keyboard shortcuts</h2>
          <button type="button" aria-label="Close shortcuts" onClick={() => help.current?.close()}>
            ×
          </button>
        </div>
        <dl className="shortcut-list">
          {[
            ["j / k · ↓ / ↑", "Move between rows"],
            ["h / l · 0 / $", "First / last action"],
            ["gg / G", "First / last row"],
            ["Enter / i", "Open or expand"],
            ["a / A", "New Plan"],
            ["/", "Find a Plan"],
            ["Escape", "Retain creation name / collapse details"],
            ["Tab / Shift+Tab", "Leave table; native form navigation"],
          ].map(([key, value]) => (
            <div key={key}>
              <dt>
                <kbd>{key}</kbd>
              </dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </dialog>
    </div>
  );
}
