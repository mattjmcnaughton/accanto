import { useEffect, useRef, useState } from "react";
import { fmtMonth, fmtShort, monthName, plural } from "../../lib/format";
import { type PlanGroup, type PlanRevision, monthly } from "../../lib/monthly";
import { confirmInAppNavigation } from "../../lib/recoverableWrite";
import { Dialog, Empty, Head } from "../../ui";
import { ActivityScreen, LoadProblem, LoadingCard, defaultDate } from "./Activity";
import { type Resolution, ReviewDetails, complete, reviewSections } from "./ReviewDetails";
import type { Screen } from "./Workspace";
import { newestFirst } from "./planWorksheetModel";
import { type ScreenProps, previousMonth, useLoad } from "./shared";
import "./activity-review.css";

const versionLabel = (r: PlanRevision) =>
  `${r.name} v${r.number}${r.saved_at ? `, saved ${fmtShort(r.saved_at.slice(0, 10))}` : ""}`;

/** The newest saved version of the Plan that owns `uuid`. */
const latestSaved = (plans: PlanGroup[], uuid: string) =>
  plans
    .find((plan) => plan.revisions.some((r) => r.uuid === uuid))
    ?.revisions.filter((r) => r.saved)
    .reduce<PlanRevision | undefined>((a, r) => (a && a.number >= r.number ? a : r), undefined);

/** The shell owns the month: changing it remounts the Review, after the unsaved-change guard. */
export function MonthlyReview(p: ScreenProps & { month?: string; go?: (to: Screen) => void }) {
  const month = p.month ?? p.entity.today.slice(0, 7);
  const priorMonth = previousMonth(month);
  const [reload, setReload] = useState(0);
  const read = useLoad(
    () => monthly.review(p.entity.id, `${month}-01`),
    [p.entity.id, month, p.refresh, reload],
    { enabled: !p.concealed, share: `review:${month}-01` },
  );
  // After a save the Review keeps what it shows until the refreshed read lands, so open
  // sections, focus and scroll stay where they were and only the totals change.
  const last = useRef<{ entity: string; state: typeof read } | null>(null);
  if (read.kind === "ready") last.current = { entity: p.entity.id, state: read };
  const refreshing = read.kind === "loading" && last.current?.entity === p.entity.id;
  const state = refreshing && last.current ? last.current.state : read;
  const previous = useLoad(
    () => monthly.review(p.entity.id, priorMonth),
    [p.entity.id, priorMonth, p.refresh, reload],
    { enabled: !p.concealed && state.kind === "empty", share: `review:${priorMonth}` },
  );
  const plans = useLoad(() => monthly.plans(p.entity.id), [p.entity.id, p.refresh, reload], {
    enabled: !p.concealed,
    share: "plans",
  });
  const [choice, setChoice] = useState("");
  const [target, setTarget] = useState("");
  const [draft, setDraft] = useState({ note: "", reviewed: false });
  const [edited, setEdited] = useState(false);
  const [help, setHelp] = useState(false);
  /** The entry opened from a section's lines, in Activity's own dialog. */
  const [entry, setEntry] = useState<string | null>(null);
  const entryDirty = useRef(false);
  const editedRef = useRef(false);
  editedRef.current = edited;
  // Follow the previous month's Plan to its latest saved version.
  useEffect(() => {
    if (previous.kind !== "ready") return setChoice("");
    const uuid = previous.data.version.uuid;
    setChoice(plans.kind === "ready" ? (latestSaved(plans.data, uuid)?.uuid ?? uuid) : uuid);
  }, [previous, plans]);
  // The compared version is saved on its own, so it always mirrors the server.
  useEffect(() => {
    if (state.kind === "ready") setTarget(state.data.version.uuid);
  }, [state]);
  // Derived while rendering, not copied in by an effect: a late effect would overwrite a
  // keystroke typed before it ran, losing attempted input.
  const saved = state.kind === "ready" ? state.data.review : null;
  const note = edited ? draft.note : (saved?.note ?? "");
  const reviewed = edited ? draft.reviewed : Boolean(saved?.reviewed_at);
  if (p.concealed) return null;
  const versions =
    plans.kind === "ready"
      ? newestFirst(plans.data.flatMap((plan) => plan.revisions.filter((r) => r.saved)))
      : [];
  const currentPlan =
    plans.kind === "ready" && state.kind === "ready"
      ? plans.data.find((plan) => plan.revisions.some((r) => r.uuid === state.data.version.uuid))
      : null;
  const newer =
    plans.kind === "ready" && state.kind === "ready"
      ? latestSaved(plans.data, state.data.version.uuid)
      : undefined;
  const newerVersion =
    state.kind === "ready" && newer && newer.number > state.data.version.number ? newer : null;
  const retry = () => setReload((x) => x + 1);
  const touch = () => {
    setEdited(true);
    p.dirty(true);
  };
  /** Saves a new compared version at once, keeping any unsaved note or mark unsaved. */
  const retarget = (version: string) => {
    if (state.kind !== "ready" || version === state.data.version.uuid) return;
    setTarget(version);
    p.save(
      monthly.editReview(p.entity.id, `${month}-01`, {
        expected_revision: state.data.review.revision,
        version_id: version,
        note: state.data.review.note,
        reviewed: Boolean(state.data.review.reviewed_at),
        checkpoint: false,
      }),
      () => p.dirty(editedRef.current),
    );
  };
  const saveReview = (changes: { reviewed?: boolean; checkpoint?: boolean } = {}) => {
    if (state.kind !== "ready") return;
    p.save(
      monthly.editReview(p.entity.id, `${month}-01`, {
        expected_revision: state.data.review.revision,
        version_id: state.data.version.uuid,
        note,
        reviewed: changes.reviewed ?? reviewed,
        checkpoint: changes.checkpoint ?? false,
      }),
      () => {
        setEdited(false);
        p.dirty(false);
      },
    );
  };
  const createReview = () => {
    if (!choice) return;
    p.save(monthly.createReview(p.entity.id, { month: `${month}-01`, version_id: choice }), () =>
      p.dirty(false),
    );
  };
  /** An answered unknown is an ordinary entry, recorded through the same write as Activity. */
  const resolve = ({ category, id, amount }: Resolution) => {
    if (p.busy || category === "investing" || category === "giving") return;
    p.save(
      monthly.createActivity(p.entity.id, {
        date: defaultDate(month, p.entity.today),
        category,
        amount,
        source_id: category === "income" ? id : null,
        fixed_cost_id: category === "fixed_cost" ? id : null,
        debt_account_id: null,
        note: amount === "0.00" ? "Nothing this month" : "",
        saving_goal_id: category === "saving" ? id : null,
      }),
      // The shell clears the unsaved flag on any confirmed write; an unsaved note keeps it.
      () => p.dirty(editedRef.current),
    );
  };
  const canChoose =
    state.kind === "empty" &&
    (previous.kind === "ready" || previous.kind === "empty") &&
    (plans.kind === "ready" || plans.kind === "empty");
  const name = monthName(`${month}-01`);
  const previousName = monthName(previousMonth(month));
  const sections = state.kind === "ready" ? reviewSections(state.data) : [];
  const unknown = sections.reduce((n, s) => n + s.unknown.length, 0);
  const done = sections.filter(complete).length;
  const ended = month < p.entity.today.slice(0, 7);
  const status =
    state.kind !== "ready"
      ? null
      : !state.data.review.reviewed_at
        ? "Not reviewed"
        : state.data.checkpoint_changed
          ? "Changed since review"
          : "Reviewed";
  return (
    <div
      className="screen ar review-screen"
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
          e.preventDefault();
          if (p.busy) return;
          if (state.kind === "ready") saveReview();
          else if (canChoose) createReview();
        } else if (
          e.key === "?" &&
          !(e.target instanceof HTMLElement && e.target.closest("input,textarea,select"))
        ) {
          e.preventDefault();
          setHelp(true);
        }
      }}
    >
      <div>
        <Head
          title={
            state.kind === "ready"
              ? `Review ${fmtMonth(month)}`
              : state.kind === "empty"
                ? `Start ${name}'s Review`
                : "Monthly Review"
          }
          sub={
            state.kind === "ready"
              ? `${done} of 6 sections complete${!unknown ? "" : ended ? `, ${plural(unknown, "unknown amount")}` : `, ${plural(unknown, "line")} still to come`}`
              : undefined
          }
        >
          {status && (
            <span
              className={`chip${status === "Reviewed" ? " good" : status === "Changed since review" ? " warn" : ""}`}
            >
              {status}
            </span>
          )}
        </Head>
        {state.kind === "ready" && (
          <>
            <div className="ar-compare">
              <label className="field">
                <span>Compared with</span>
                <select
                  className="input"
                  value={target}
                  required
                  disabled={p.busy}
                  onChange={(e) => retarget(e.target.value)}
                >
                  {newestFirst(
                    currentPlan?.revisions.filter((r) => r.saved) || [state.data.version],
                  ).map((r) => (
                    <option key={r.uuid} value={r.uuid}>
                      {versionLabel(r)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="pace ar-pace" role="img" aria-label={`${done} of 6 sections complete`}>
              <i style={{ width: `${(done / 6) * 100}%` }} />
            </div>
          </>
        )}
      </div>
      {newerVersion && state.kind === "ready" && (
        <output className="ar-banner">
          <span>Newer version saved: {versionLabel(newerVersion)}.</span>
          <button
            type="button"
            className="btn sm"
            disabled={p.busy}
            onClick={() => retarget(newerVersion.uuid)}
          >
            Compare with v{newerVersion.number}
          </button>
        </output>
      )}
      {state.kind === "ready" && Boolean(state.data.inbox_waiting) && (
        <output className="ar-banner">
          <span>
            {plural(state.data.inbox_waiting ?? 0, "transaction")} waiting in the inbox, not in
            these totals.
          </span>
          {p.go && (
            <button type="button" className="btn sm" onClick={() => p.go?.("inbox")}>
              Open the inbox
            </button>
          )}
        </output>
      )}
      <LoadProblem
        states={state.kind === "empty" ? [state, previous, plans] : [state]}
        retry={retry}
      />
      {(state.kind === "loading" ||
        (state.kind === "empty" && (previous.kind === "loading" || plans.kind === "loading"))) && (
        <LoadingCard label="Loading the Review" />
      )}
      {state.kind === "empty" &&
        canChoose &&
        (versions.length === 0 ? (
          <Empty
            title="A Review needs a saved Plan version"
            action={
              p.go && (
                <button type="button" className="btn pri" onClick={() => p.go?.("plans")}>
                  Open Plans
                </button>
              )
            }
          >
            Save a Plan version first.
          </Empty>
        ) : (
          <form
            className="card pad stack ar-start"
            onSubmit={(e) => {
              e.preventDefault();
              createReview();
            }}
          >
            <fieldset disabled={p.busy} className="ar-fs stack">
              <label className="field">
                <span>Compare with</span>
                <select
                  required
                  value={choice}
                  aria-describedby="review-start-hint"
                  onChange={(e) => {
                    setChoice(e.target.value);
                    p.dirty(true);
                  }}
                >
                  <option value="" disabled>
                    Choose a saved version
                  </option>
                  {versions.map((version) => (
                    <option key={version.uuid} value={version.uuid}>
                      {versionLabel(version)}
                    </option>
                  ))}
                </select>
              </label>
              <small id="review-start-hint" className="note">
                {previous.kind === "ready"
                  ? `Preselected from ${previousName}'s Review.`
                  : `${previousName} has no Review.`}
              </small>
              <div>
                <button type="submit" className="btn pri" disabled={!choice}>
                  Start Review
                </button>
              </div>
            </fieldset>
          </form>
        ))}
      {state.kind === "ready" && (
        <>
          <ReviewDetails
            review={state.data}
            current={month === p.entity.today.slice(0, 7)}
            ended={ended}
            busy={p.busy || refreshing}
            resolve={resolve}
            open={(uuid) => !p.busy && setEntry(uuid)}
            onHelp={() => setHelp(true)}
          />
          {entry && (
            <ActivityScreen
              key={entry}
              {...p}
              month={month}
              detail={{ id: entry, closed: () => setEntry(null) }}
              // The entry's changes and the Review note are separate: opening or leaving the
              // entry never asks about the note, and saving the entry keeps the note unsaved.
              guard={() => !p.busy && confirmInAppNavigation(() => entryDirty.current)}
              dirty={(value) => {
                entryDirty.current = value;
                p.dirty(value || editedRef.current);
              }}
            />
          )}
          <form
            className="card pad stack"
            aria-label="Close the month"
            onSubmit={(e) => {
              e.preventDefault();
              saveReview();
            }}
          >
            <fieldset disabled={p.busy} className="ar-fs stack">
              <label className="field">
                <span>Review note</span>
                <textarea
                  value={note}
                  maxLength={4000}
                  placeholder={`Anything worth remembering about ${name}`}
                  onChange={(e) => {
                    setDraft({ note: e.target.value, reviewed });
                    touch();
                  }}
                />
              </label>
              {state.data.checkpoint_changed && state.data.review.reviewed_at && (
                <p className="ar-banner">
                  Activity changed after you marked {name} reviewed. Update the checkpoint to accept
                  it.
                </p>
              )}
              <div className="actions ar-close">
                <button
                  type="button"
                  className="btn pri"
                  onClick={() => saveReview({ reviewed: !reviewed })}
                >
                  {reviewed
                    ? "Reviewed. Clear the mark"
                    : unknown
                      ? `Mark reviewed with ${ended ? plural(unknown, "unknown") : `${unknown} still to come`}`
                      : `Mark ${name} reviewed`}
                </button>
                {edited && (
                  <button type="submit" className="btn">
                    Save changes
                  </button>
                )}
                {reviewed && state.data.review.reviewed_at && (
                  <button
                    type="button"
                    className="btn quiet"
                    onClick={() => saveReview({ checkpoint: true })}
                  >
                    Update checkpoint
                  </button>
                )}
                {edited && <span className="chip warn">Unsaved Review changes</span>}
              </div>
            </fieldset>
          </form>
        </>
      )}
      {help && (
        <Dialog title="Keyboard shortcuts" onClose={() => setHelp(false)} className="ar">
          <div className="dlg-b">
            <dl className="ar-keylist">
              {[
                ["j k / arrows", "Move between sections"],
                ["gg / G", "First or last section"],
                ["Enter / i / Space", "Show or hide a section's lines"],
                ["Tab, then Enter", "Open an entry in a section's lines to view or edit it"],
                ["Tab", "Move to a section's questions, the note and actions"],
                ["Ctrl / ⌘ + S", "Save the Review (or start it)"],
              ].map(([key, label]) => (
                <div key={key}>
                  <dt>
                    <kbd className="kbd">{key}</kbd>
                  </dt>
                  <dd>{label}</dd>
                </div>
              ))}
            </dl>
          </div>
        </Dialog>
      )}
    </div>
  );
}
