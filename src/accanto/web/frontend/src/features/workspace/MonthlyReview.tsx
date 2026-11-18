import { useEffect, useId, useRef, useState } from "react";
import { monthly } from "../../lib/monthly";
import { ReviewDetails } from "./ReviewDetails";
import { LoadMessage, type ScreenProps, previousMonth, useLoad } from "./shared";
import "./worksheet-ui.css";
import "./activity-review.css";

const nextMonth = (month: string) => {
  const [year, number] = month.split("-").map(Number);
  return `${number === 12 ? year + 1 : year}-${String(number === 12 ? 1 : number + 1).padStart(2, "0")}`;
};
export function MonthlyReview(p: ScreenProps) {
  const [month, setMonth] = useState(p.entity.today.slice(0, 7));
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
  const [area, setArea] = useState<"page" | "table" | "details">("page");
  const [help, setHelp] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const helpTitle = useId();
  const priorFocus = useRef<HTMLElement | null>(null);
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
  useEffect(() => {
    if (help) {
      priorFocus.current = document.activeElement as HTMLElement | null;
      dialog.current?.showModal?.();
    } else if (dialog.current?.open) {
      dialog.current.close();
      priorFocus.current?.focus();
    }
  }, [help]);
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
  const saveReview = (checkpoint = false) => {
    if (state.kind !== "ready" || !target) return;
    p.save(
      monthly.editReview(p.entity.id, `${month}-01`, {
        expected_revision: state.data.review.revision,
        version_id: target,
        note,
        reviewed,
        checkpoint,
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
  const go = (value: string) => {
    if (value && value !== month && !p.busy && p.guard()) {
      setMonth(value);
      setChoice("");
      setEdited(false);
      p.dirty(false);
    }
  };
  const canChoose =
    state.kind === "empty" &&
    (previous.kind === "ready" || previous.kind === "empty") &&
    (plans.kind === "ready" || plans.kind === "empty");
  const status =
    state.kind !== "ready"
      ? null
      : !state.data.review.reviewed_at
        ? "Not reviewed"
        : state.data.checkpoint_changed
          ? "Changed since review"
          : "Reviewed";
  return (
    <section
      className="data-workspace review-screen"
      aria-labelledby="review-title"
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
          e.preventDefault();
          if (p.busy) return;
          if (state.kind === "ready") saveReview();
          else if (canChoose) createReview();
        }
      }}
    >
      <div className="data-toolbar">
        <h2 id="review-title">Monthly Review</h2>
        <button
          type="button"
          className="icon-button"
          aria-label="Previous month"
          disabled={p.busy}
          onClick={() => go(previousMonth(month).slice(0, 7))}
        >
          ‹
        </button>
        <label>
          <span className="sr-only">Review month</span>
          <input
            type="month"
            aria-label="Review month"
            required
            value={month}
            disabled={p.busy}
            onChange={(e) => go(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="icon-button"
          aria-label="Next month"
          disabled={p.busy}
          onClick={() => go(nextMonth(month))}
        >
          ›
        </button>
        {state.kind === "ready" && (
          <>
            <span className="badge">
              {state.data.version.name} · v{state.data.version.number}
            </span>
            <span className={`badge${status === "Changed since review" ? " pending" : ""}`}>
              {status}
            </span>
          </>
        )}
      </div>
      <LoadMessage state={state} retry={retry} />
      {state.kind === "empty" && (
        <>
          <LoadMessage state={previous} retry={retry} />
          <LoadMessage state={plans} retry={retry} />
        </>
      )}
      <div className={`data-layout${state.kind === "ready" || canChoose ? " with-sidebar" : ""}`}>
        <div
          className="review-main"
          onFocus={() => setArea("table")}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget)) setArea("page");
          }}
        >
          {state.kind === "ready" && (
            <ReviewDetails review={state.data} onHelp={() => setHelp(true)} />
          )}
          {state.kind === "empty" && (
            <p className="empty-state">
              No Review for {month}. Existing activity is included when you create one; creating a
              Review adds no activity.
            </p>
          )}
        </div>
        {(state.kind === "ready" || canChoose) && (
          <aside
            className="data-sidebar"
            aria-label="Review details"
            onFocus={() => setArea("details")}
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget)) setArea("page");
            }}
          >
            {canChoose && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  createReview();
                }}
              >
                <fieldset disabled={p.busy}>
                  <legend>Start this month's Review</legend>
                  <p className="muted">
                    {previous.kind === "ready"
                      ? "Previous month's comparison preselected."
                      : "No previous Review. Choose a saved version."}
                  </p>
                  <label>
                    Comparison version
                    <select
                      required
                      value={choice}
                      onChange={(e) => {
                        setChoice(e.target.value);
                        p.dirty(true);
                      }}
                    >
                      <option value="">Choose a saved version</option>
                      {versions.map((version) => (
                        <option key={version.uuid} value={version.uuid}>
                          {version.name} · v{version.number}
                        </option>
                      ))}
                    </select>
                  </label>
                  {versions.length === 0 && (
                    <p className="muted">Save a Plan version before starting a Review.</p>
                  )}
                  <div className="sidebar-actions">
                    <button type="submit" className="primary" disabled={!choice}>
                      Create Review
                    </button>
                  </div>
                </fieldset>
              </form>
            )}
            {state.kind === "ready" && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  saveReview();
                }}
              >
                <fieldset disabled={p.busy}>
                  <legend>Review</legend>
                  <label>
                    Comparison version
                    <select
                      value={target}
                      required
                      onChange={(e) => {
                        setTarget(e.target.value);
                        touch();
                      }}
                    >
                      {(currentPlan?.revisions.filter((r) => r.saved) || [state.data.version]).map(
                        (r) => (
                          <option key={r.uuid} value={r.uuid}>
                            {r.name} · v{r.number}
                          </option>
                        ),
                      )}
                    </select>
                  </label>
                  <label>
                    Review note
                    <textarea
                      value={note}
                      maxLength={4000}
                      onChange={(e) => {
                        setNote(e.target.value);
                        touch();
                      }}
                    />
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={reviewed}
                      onChange={(e) => {
                        setReviewed(e.target.checked);
                        touch();
                      }}
                    />
                    Mark reviewed
                  </label>
                  <p className="muted">Reviewed months stay editable, even with unknowns.</p>
                  <div className="sidebar-actions">
                    <button type="submit" className="primary" disabled={!target}>
                      Save Review
                    </button>
                    {reviewed && state.data.review.reviewed_at && (
                      <button type="button" onClick={() => saveReview(true)}>
                        Update checkpoint
                      </button>
                    )}
                  </div>
                </fieldset>
              </form>
            )}
          </aside>
        )}
      </div>
      <footer id="review-status" className="data-status">
        <span className="mode">
          {area === "table" ? "READ ONLY" : area === "details" ? "DETAILS" : "READY"}
        </span>
        <span>
          <kbd>h j k l</kbd> Move <kbd>Enter</kbd> Expand <kbd>Ctrl/⌘ S</kbd> Save Review{" "}
          <kbd>?</kbd> Keys
        </span>
        {edited && <span className="pending">Unsaved Review changes</span>}
      </footer>
      <dialog ref={dialog} aria-labelledby={helpTitle} onClose={() => setHelp(false)}>
        <h2 id={helpTitle}>Keyboard shortcuts</h2>
        <dl className="shortcut-list">
          {[
            ["h j k l / arrows", "Move between cells"],
            ["0 / $ · gg / G", "First or last cell, row"],
            ["i / Enter / Space", "Expand or collapse a row"],
            ["Tab", "Move to the Review note and actions"],
            ["Ctrl / ⌘ + S", "Save Review (or create it)"],
          ].map(([key, label]) => (
            <div key={key}>
              <dt>
                <kbd>{key}</kbd>
              </dt>
              <dd>{label}</dd>
            </div>
          ))}
        </dl>
        <button type="button" onClick={() => setHelp(false)}>
          Close
        </button>
      </dialog>
    </section>
  );
}
