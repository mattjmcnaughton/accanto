import { useEffect, useRef, useState } from "react";
import type { LoadState } from "../../lib/api";
import { balances } from "../../lib/balances";
import { destinations } from "../../lib/destinations";
import { fmtDate } from "../../lib/format";
import { type PlanGroup, type PlanRevision, monthly } from "../../lib/monthly";
import { confirmInAppNavigation } from "../../lib/recoverableWrite";
import { routines } from "../../lib/routines";
import { savings } from "../../lib/savings";
import { spendingSubcategories } from "../../lib/spendingSubcategories";
import { parseTimestamp } from "../../lib/timestamp";
import { Band, Dialog, Empty, Icon, Skeleton } from "../../ui";
import { SubcategoriesDialog } from "../tags/Subcategories";
import { Home } from "./Home";
import { CopyPlan } from "./PlanScenarios";
import { PlanWorksheet } from "./PlanWorksheet";
import {
  type Catalog,
  type WorksheetDraft,
  allocationBand,
  balance,
  lineGroups,
  money,
  planInput,
  revisionLines,
  savedLabel,
  storedGroups,
  storedTotals,
  totals,
} from "./planWorksheetModel";
import type { Screen } from "./Workspace";
import { LoadMessage, type ScreenProps, composing, useLoad } from "./shared";
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
    /** The shell's month, which Home shows. */
    month?: string;
    showPlans?: () => void;
    /** Opens another screen, for Home's links. */
    go?: (to: Screen) => void;
    /** Opens a routine's occurrence from Home. */
    openRoutine?: (routine: string, on: string) => void;
    retainedDirty?: (value: boolean) => void;
  },
) {
  const [reload, setReload] = useState(0);
  const [active, setActive] = useState<string | null>(null);
  const shown = p.visible !== false && !p.concealed;
  const worksheet = shown && !p.home && active !== null;
  const home = shown && !!p.home;
  const deps = [p.entity.id, p.refresh, reload];
  const state = useLoad(() => monthly.plans(p.entity.id), deps, { enabled: shown, share: "plans" });
  const accounts = useLoad(() => savings.list(p.entity.id), deps, {
    enabled: home || worksheet,
    share: "savings",
  });
  const investments = useLoad(() => destinations.list(p.entity.id, "investment"), deps, {
    enabled: home || worksheet,
    share: "investments",
  });
  const giving = useLoad(() => destinations.list(p.entity.id, "giving"), deps, {
    enabled: worksheet,
    share: "giving",
  });
  const subcategories = useLoad(() => spendingSubcategories.list(p.entity.id), deps, {
    enabled: worksheet,
    share: "spending-subcategories",
  });
  const [managingSubcategories, setManagingSubcategories] = useState(false);
  const loans = useLoad(() => balances.loans(p.entity.id), deps, {
    enabled: home || worksheet,
    share: "loans",
  });
  const routineList = useLoad(() => routines.list(p.entity.id), deps, {
    enabled: home,
    share: "routines",
  });
  // Home compares the shell's month with its Review, read exactly as the Review screen reads it.
  const month = p.month ?? p.entity.today.slice(0, 7);
  const review = useLoad(
    () => monthly.review(p.entity.id, `${month}-01`),
    [p.entity.id, month, p.refresh, reload],
    { enabled: home, share: `review:${month}-01` },
  );
  const [opened, setOpened] = useState<Record<string, OpenDraft>>({});
  useEffect(() => {
    if (p.home) setActive(null);
  }, [p.home]);
  const [creating, setCreating] = useState(false);
  // The copy dialog, with the revision it starts from when opened from a worksheet.
  const [copying, setCopying] = useState<false | { from?: string }>(false);
  const [name, setName] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<Record<string, PlanGroup>>({});
  const [help, setHelp] = useState(false);
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
  // The update instant, as a calendar date in the Entity time zone.
  const updated = (plan: PlanGroup) => {
    const value = parseTimestamp(draftOf(plan)?.updated_at);
    return value !== null
      ? fmtDate(
          new Intl.DateTimeFormat("en-CA", {
            timeZone: p.entity.time_zone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
          }).format(new Date(value)),
        )
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
    setHelp(true);
  }
  function closeCopy() {
    if (!p.guard()) return;
    p.dirty(false);
    setCopying(false);
  }
  /** Rows of a list move like a table: j/k or arrows, gg/G, h/l between a row's buttons. */
  function keys(event: React.KeyboardEvent<HTMLElement>) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const button = (event.target as HTMLElement).closest("button");
    if (!button) return;
    const rows = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>("[data-keyrow]"),
    ).filter((row) => row.querySelector("button"));
    const currentRow = button.closest<HTMLElement>("[data-keyrow]");
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
  if (!shown) return null;
  const visible = plans.filter((plan) =>
    displayName(plan).toLowerCase().includes(query.trim().toLowerCase()),
  );
  const statsOf = (plan: PlanGroup) => {
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
    const amounts =
      dirty && local?.input
        ? lineGroups(local.input.editing ? null : local.input.lines)
        : revision
          ? storedGroups(revision)
          : lineGroups(null);
    return { dirty, stats, amounts };
  };
  const attention = plans.flatMap((plan) => {
    const { dirty, stats } = statsOf(plan);
    return dirty || (stats.unassigned !== null && stats.unassigned < 0)
      ? [{ id: plan.plan_id, name: displayName(plan), dirty, ...stats }]
      : [];
  });
  const ready = state.kind === "ready" || state.kind === "empty";
  return (
    <div
      className="planning"
      ref={root}
      onKeyDown={(event) => {
        if (
          (!home && active) ||
          event.ctrlKey ||
          event.metaKey ||
          event.altKey ||
          help ||
          copying ||
          (event.target as HTMLElement).closest("input,select,textarea,dialog")
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
      {!home ? null : state.kind === "loading" ? (
        <Skeleton />
      ) : !ready ? (
        <div className="screen">
          <div className="card pad">
            <LoadMessage state={state} retry={() => setReload((n) => n + 1)} />
          </div>
        </div>
      ) : null}
      {ready && home && (
        <Home
          month={month}
          today={p.entity.today}
          plans={plans.length}
          hasVersion={plans.some((plan) => versionsOf(plan).length > 0)}
          attention={attention}
          recent={plans.slice(0, 3).map((plan) => ({
            id: plan.plan_id,
            name: displayName(plan),
            detail: `${changed(opened[plan.plan_id]) ? "Unsaved changes in this tab" : "Saved draft"}, updated ${updated(plan)}`,
          }))}
          review={review}
          accounts={accounts}
          investments={investments}
          loans={loans}
          open={(id) => {
            const plan = plans.find((item) => item.plan_id === id);
            if (plan) open(plan);
          }}
          newPlan={newPlan}
          showPlans={() => {
            setActive(null);
            p.showPlans?.();
          }}
          go={p.go}
          routines={routineList}
          openRoutine={p.openRoutine}
          retry={() => setReload((n) => n + 1)}
        />
      )}
      {!home && !active && (
        <div className="screen" id="plans-index">
          <div className="head">
            <div>
              <h1 className="h1">Plans</h1>
              <p className="sub">
                A Plan gives every dollar of a month a job. Save a version when you want to compare
                a month against it.
              </p>
            </div>
            <div className="head-actions">
              <button
                type="button"
                className="btn"
                disabled={p.busy || !plans.length}
                onClick={() => {
                  setCopying({});
                  setCreating(false);
                }}
              >
                <Icon name="copy" />
                Copy Plan
              </button>
              <button
                type="button"
                id="new-plan"
                className="btn pri"
                disabled={p.busy}
                onClick={newPlan}
              >
                <Icon name="plus" />
                New Plan
              </button>
            </div>
          </div>
          {creating && (
            <form
              id="plan-create"
              className="card pad plan-create"
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
                <div className="field">
                  <label htmlFor="new-plan-name">Plan name</label>
                  <input
                    id="new-plan-name"
                    maxLength={120}
                    value={name}
                    placeholder="For example, Everyday balance"
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
                    <p role="alert" className="err">
                      Enter a Plan name.
                    </p>
                  )}
                  <small>
                    The Plan starts with one Net income line; add the rest in its worksheet.
                  </small>
                </div>
                <div className="actions">
                  <button type="submit" id="create-plan" className="btn pri">
                    Create and open
                  </button>
                  <button
                    type="button"
                    className="btn quiet"
                    onClick={() => {
                      setCreating(false);
                      focus("#new-plan");
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </fieldset>
            </form>
          )}
          {state.kind === "loading" && (
            <div className="stack" aria-busy="true" aria-label="Loading Plans">
              {[1, 2].map((n) => (
                <div key={n} className="card pad sk-card">
                  <div className="sk" style={{ width: "40%", height: 18 }} />
                  <div className="sk" style={{ height: 10 }} />
                </div>
              ))}
            </div>
          )}
          {!ready && state.kind !== "loading" && (
            <div className="card pad">
              <LoadMessage state={state} retry={() => setReload((n) => n + 1)} />
            </div>
          )}
          {plans.length > 0 && (
            <div className="plans-controls">
              <label className="sr-only" htmlFor="plan-search">
                Find a Plan
              </label>
              <input
                id="plan-search"
                className="input"
                placeholder="Find a Plan…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") focus(".plan-open");
                }}
              />
              <button type="button" className="btn quiet sm" onClick={showHelp}>
                Keyboard shortcuts <span className="kbd">?</span>
              </button>
            </div>
          )}
          {visible.length > 0 && (
            <ul className="stack plan-list" aria-label="Plans" onKeyDown={keys}>
              {visible.map((plan) => {
                const versions = versionsOf(plan);
                const latest = versions[versions.length - 1];
                const { dirty, stats, amounts } = statsOf(plan);
                const tone = balance(stats);
                const band = allocationBand(amounts, stats.unassigned);
                return (
                  <li key={plan.plan_id} className="card plan-card" data-keyrow>
                    <div className="plan-card-main">
                      <h2>
                        <button
                          type="button"
                          className="plan-open"
                          disabled={p.busy}
                          onClick={() => open(plan)}
                        >
                          {displayName(plan)}
                        </button>
                        <span className={`chip ${tone.tone}`}>{tone.text}</span>
                        {dirty && <span className="chip warn">Unsaved changes</span>}
                      </h2>
                      <span className="note">
                        {money(stats.funding)} a month. Updated {updated(plan)}.{" "}
                        {latest
                          ? `${versions.length === 1 ? "One saved version" : `${versions.length} saved versions`}, latest ${savedLabel(latest, p.entity.time_zone).replace("Version", "version")}.`
                          : "No saved versions."}
                      </span>
                    </div>
                    <div className="head-actions">
                      <button
                        type="button"
                        className="btn sm quiet"
                        aria-label={`Details for ${displayName(plan)}`}
                        aria-expanded={expanded === plan.plan_id}
                        onClick={() => setExpanded(expanded === plan.plan_id ? null : plan.plan_id)}
                      >
                        Versions
                        <Icon name={expanded === plan.plan_id ? "down" : "right"} />
                      </button>
                    </div>
                    {band && (stats.funding ?? 0) + (stats.allocated ?? 0) > 0 && (
                      <div className="plan-card-band">
                        <Band parts={band} label={`Allocation of ${displayName(plan)}`} />
                      </div>
                    )}
                    {expanded === plan.plan_id && (
                      <div className="plan-versions">
                        {versions.length ? (
                          versions.map((version) => (
                            <p key={version.uuid}>
                              {savedLabel(version, p.entity.time_zone)}
                              <span className="muted"> · {version.name}</span>
                            </p>
                          ))
                        ) : (
                          <p className="muted">
                            No saved versions. Open the Plan and choose Save version.
                          </p>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {ready &&
            !visible.length &&
            (plans.length ? (
              <Empty
                title="No matching Plans"
                action={
                  <button type="button" className="btn" onClick={() => setQuery("")}>
                    Clear search
                  </button>
                }
              >
                No Plan name contains “{query.trim()}”.
              </Empty>
            ) : (
              !creating && (
                <Empty
                  title="No Plans yet"
                  action={
                    <button type="button" className="btn pri" onClick={newPlan}>
                      Create your first Plan
                    </button>
                  }
                >
                  Start with what comes in each month, then assign it to fixed costs, guilt-free
                  spending, saving, investing and giving.
                </Empty>
              )
            ))}
        </div>
      )}
      {Object.entries(opened)
        .filter(([id]) => id === active)
        .map(([id, local]) => {
          const plan = plans.find((plan) => plan.plan_id === id);
          const current = plan && draftOf(plan);
          return (
            <div key={id} data-plan={id} hidden={home || active !== id} className="plan-open-sheet">
              {current &&
                (current.uuid !== local.revision.uuid ||
                  current.revision !== local.revision.revision) && (
                  <div role="alert" className="banner bad plan-alert">
                    <span>The stored draft changed. Your attempted input is retained.</span>
                    <button
                      type="button"
                      className="btn sm"
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
                { name: "Spending subcategories", state: subcategories },
              ].map((item) =>
                item.state.kind === "ready" || item.state.kind === "empty" ? null : (
                  <div key={item.name} className="plan-alert plan-catalog">
                    <p className="cap">{item.name}</p>
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
                subcategories={
                  subcategories.kind === "ready"
                    ? subcategories.data.filter((sub) => sub.active)
                    : []
                }
                onSubcategories={() => setManagingSubcategories(true)}
                busy={p.busy}
                timeZone={p.entity.time_zone}
                onBack={() => setActive(null)}
                onCopy={
                  plan
                    ? () => {
                        setCopying({ from: draftOf(plan)?.uuid });
                        setCreating(false);
                      }
                    : undefined
                }
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
      {managingSubcategories && worksheet && (
        <SubcategoriesDialog
          entityId={p.entity.id}
          subcategories={subcategories.kind === "ready" ? subcategories.data : []}
          busy={p.busy}
          save={p.save}
          onClose={() => setManagingSubcategories(false)}
        />
      )}
      {copying && !home && (
        <Dialog title="Copy a Plan" onClose={closeCopy} className="plan-copy-dlg">
          <CopyPlan
            plans={plans}
            screen={p}
            copied={accepted}
            initial={copying.from}
            onCancel={closeCopy}
          />
        </Dialog>
      )}
      {help && (
        <Dialog title="Keyboard shortcuts" onClose={() => setHelp(false)}>
          <div className="dlg-b">
            <dl className="shortcut-list">
              {[
                ["j / k · ↓ / ↑", "Move between Plans"],
                ["h / l · 0 / $", "First / last action"],
                ["gg / G", "First / last Plan"],
                ["Enter / i", "Open or expand"],
                ["a / A", "New Plan"],
                ["/", "Find a Plan"],
                ["Escape", "Keep the new Plan name / collapse versions"],
                ["Tab / Shift+Tab", "Leave the list; native form navigation"],
              ].map(([key, value]) => (
                <div key={key}>
                  <dt>
                    <span className="kbd">{key}</span>
                  </dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </Dialog>
      )}
    </div>
  );
}
