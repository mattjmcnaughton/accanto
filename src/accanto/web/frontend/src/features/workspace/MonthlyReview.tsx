import { useEffect, useRef, useState } from "react";
import { fmtMonth, fmtShort, monthName, plural } from "../../lib/format";
import { type PlanRevision, monthly } from "../../lib/monthly";
import { Dialog, Empty, Head } from "../../ui";
import { LoadProblem, LoadingCard, defaultDate } from "./Activity";
import { type Resolution, ReviewDetails, complete, reviewSections } from "./ReviewDetails";
import type { Screen } from "./Workspace";
import { type ScreenProps, previousMonth, useLoad } from "./shared";
import "./activity-review.css";

const versionLabel = (r: PlanRevision) =>
  `${r.name} v${r.number}${r.saved_at ? `, saved ${fmtShort(r.saved_at.slice(0, 10))}` : ""}`;

/** The shell owns the month: changing it remounts the Review, after the unsaved-change guard. */
export function MonthlyReview(p: ScreenProps & { month?: string; go?: (to: Screen) => void }) {
  const month = p.month ?? p.entity.today.slice(0, 7);
  const [reload, setReload] = useState(0);
  const state = useLoad(
    () => monthly.review(p.entity.id, `${month}-01`),
    [p.entity.id, month, p.refresh, reload],
  );
  const previous = useLoad(
    () => monthly.review(p.entity.id, previousMonth(month)),
    [p.entity.id, month, p.refresh, reload],
  );
  const plans = useLoad(() => monthly.plans(p.entity.id), [p.entity.id, p.refresh, reload]);
  const [choice, setChoice] = useState("");
  const [target, setTarget] = useState("");
  const [note, setNote] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [edited, setEdited] = useState(false);
  const [help, setHelp] = useState(false);
  const editedRef = useRef(false);
  editedRef.current = edited;
  useEffect(() => {
    setChoice(previous.kind === "ready" ? previous.data.version.uuid : "");
  }, [previous]);
  useEffect(() => {
    if (state.kind === "ready" && !edited) {
      setTarget(state.data.version.uuid);
      setNote(state.data.review.note);
      setReviewed(Boolean(state.data.review.reviewed_at));
    }
  }, [state, edited]);
  if (p.concealed) return null;
  const versions =
    plans.kind === "ready"
      ? plans.data.flatMap((plan) => plan.revisions.filter((r) => r.saved))
      : [];
  const currentPlan =
    plans.kind === "ready" && state.kind === "ready"
      ? plans.data.find((plan) => plan.revisions.some((r) => r.uuid === state.data.version.uuid))
      : null;
  const retry = () => setReload((x) => x + 1);
  const touch = () => {
    setEdited(true);
    p.dirty(true);
  };
  const saveReview = (changes: { reviewed?: boolean; checkpoint?: boolean } = {}) => {
    if (state.kind !== "ready" || !target) return;
    p.save(
      monthly.editReview(p.entity.id, `${month}-01`, {
        expected_revision: state.data.review.revision,
        version_id: target,
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
        funding_origin: "income",
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
              ? `${done} of 6 sections are complete${unknown ? `, with ${plural(unknown, "unknown amount")}` : ""}.`
              : state.kind === "empty"
                ? "Choose the saved Plan version to compare this month against. Starting a Review creates no activity, and you can change the version later."
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
                  onChange={(e) => {
                    setTarget(e.target.value);
                    touch();
                  }}
                >
                  {(currentPlan?.revisions.filter((r) => r.saved) || [state.data.version]).map(
                    (r) => (
                      <option key={r.uuid} value={r.uuid}>
                        {versionLabel(r)}
                      </option>
                    ),
                  )}
                </select>
              </label>
            </div>
            <div className="pace ar-pace" role="img" aria-label={`${done} of 6 sections complete`}>
              <i style={{ width: `${(done / 6) * 100}%` }} />
            </div>
          </>
        )}
      </div>
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
            A Review compares what you recorded in {name} against one saved version of a Plan. Open
            a Plan in Plans and choose Save version, then come back.
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
                  : `${previousName} has no Review, so nothing is preselected.`}{" "}
                Activity already recorded in {name} is included.
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
            busy={p.busy}
            resolve={resolve}
            onHelp={() => setHelp(true)}
          />
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
                    setNote(e.target.value);
                    touch();
                  }}
                />
              </label>
              {state.data.checkpoint_changed && state.data.review.reviewed_at && (
                <p className="ar-banner">
                  Activity changed after you marked {name} reviewed. Look over the sections, then
                  update the checkpoint to accept the changes.
                </p>
              )}
              <div className="actions ar-close">
                <button
                  type="button"
                  className="btn pri"
                  disabled={!target}
                  onClick={() => saveReview({ reviewed: !reviewed })}
                >
                  {reviewed
                    ? "Reviewed. Clear the mark"
                    : unknown
                      ? `Mark reviewed with ${plural(unknown, "unknown")}`
                      : `Mark ${name} reviewed`}
                </button>
                {edited && (
                  <button type="submit" className="btn" disabled={!target}>
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
                <span className="note">
                  A reviewed month stays editable, and unknown amounts stay unknown.
                </span>
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
