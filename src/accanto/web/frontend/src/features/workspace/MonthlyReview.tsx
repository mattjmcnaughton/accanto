import { useEffect, useState } from "react";
import { monthly } from "../../lib/monthly";
import { LoadMessage, type ScreenProps, dollars, previousMonth, useLoad } from "./shared";
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
  const saveReview = (checkpoint = false) => {
    if (state.kind !== "ready") return;
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
  const canChoose =
    state.kind === "empty" &&
    (previous.kind === "ready" || previous.kind === "empty") &&
    (plans.kind === "ready" || plans.kind === "empty");
  return (
    <section aria-labelledby="review-title">
      <div className="section-heading">
        <div>
          <h2 id="review-title">Monthly Review</h2>
          <p>Compare recorded activity with one saved Plan version.</p>
        </div>
        <label>
          Review month
          <input
            type="month"
            required
            value={month}
            disabled={p.busy}
            onChange={(e) => {
              if (e.target.value && p.guard()) {
                setMonth(e.target.value);
                setChoice("");
                setEdited(false);
                p.dirty(false);
              }
            }}
          />
        </label>
      </div>
      <LoadMessage state={state} retry={retry} />
      {state.kind === "empty" && (
        <>
          <LoadMessage state={previous} retry={retry} />
          <LoadMessage state={plans} retry={retry} />
        </>
      )}
      {canChoose && (
        <form
          className="editor"
          onSubmit={(e) => {
            e.preventDefault();
            p.save(
              monthly.createReview(p.entity.id, {
                month: `${month}-01`,
                version_id: choice,
              }),
              () => p.dirty(false),
            );
          }}
        >
          <fieldset disabled={p.busy}>
            <legend>Start this month's Review</legend>
            <p>
              {previous.kind === "ready"
                ? "The previous calendar month's comparison is preselected. Confirm it or choose another saved version."
                : "There is no Review for the previous calendar month. Choose a saved version explicitly."}
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
            {versions.length === 0 && <p>Save a Plan version before starting a Review.</p>}
            <button type="submit" className="primary" disabled={!choice}>
              Create Review
            </button>
            <p>Existing activity is included. Creating a Review adds no activity.</p>
          </fieldset>
        </form>
      )}
      {state.kind === "ready" && (
        <>
          <form
            className="editor"
            onSubmit={(e) => {
              e.preventDefault();
              saveReview();
            }}
          >
            <fieldset disabled={p.busy}>
              <legend>Review notes and checkpoint</legend>
              <label>
                Comparison version
                <select
                  value={target}
                  required
                  onChange={(e) => {
                    setTarget(e.target.value);
                    setEdited(true);
                    p.dirty(true);
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
                    setEdited(true);
                    p.dirty(true);
                  }}
                />
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={reviewed}
                  onChange={(e) => {
                    setReviewed(e.target.checked);
                    setEdited(true);
                    p.dirty(true);
                  }}
                />{" "}
                Mark reviewed
              </label>
              <button type="submit" className="primary" disabled={!target}>
                Save Review
              </button>
              {reviewed && state.data.review.reviewed_at && (
                <button type="button" onClick={() => saveReview(true)}>
                  Update checkpoint
                </button>
              )}
              <p>A reviewed month remains editable even when amounts are unknown.</p>
            </fieldset>
          </form>
          {state.data.review.reviewed_at && (
            <p>
              {state.data.checkpoint_changed
                ? "Changed since review. Your annotation remains set."
                : "Marked reviewed."}
            </p>
          )}
          <h3>
            {state.data.version.name} · v{state.data.version.number}
          </h3>
          <p>Saved comparison for {month}. Later Plan versions do not change this Review.</p>
          <div className="comparison-scroll">
            <table className="comparison">
              <caption>USD · recorded minus planned</caption>
              <thead>
                <tr>
                  <th scope="col">Category</th>
                  <th scope="col">Planned</th>
                  <th scope="col">Recorded</th>
                  <th scope="col">Difference</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">Net income</th>
                  <td>{dollars(state.data.version.income)}</td>
                  <td>
                    {dollars(state.data.actual.income_recorded)}
                    {state.data.actual.income_incomplete && " (incomplete)"}
                  </td>
                  <td>{dollars(state.data.income_difference)}</td>
                </tr>
                <tr>
                  <th scope="row">Guilt-free spending</th>
                  <td>{dollars(state.data.version.spending)}</td>
                  <td>{dollars(state.data.actual.spending_recorded)}</td>
                  <td>{dollars(state.data.spending_difference)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          {state.data.actual.missing_sources.length > 0 && (
            <div className="warning">
              <p>Income remains unknown for:</p>
              <ul>
                {state.data.actual.missing_sources.map((id) => (
                  <li key={id}>
                    {state.data.version.incomes.find((line) => line.source_id === id)?.name ||
                      "Historical source"}
                  </li>
                ))}
              </ul>
              <p>Record an entry for each source, including an explicit zero when appropriate.</p>
            </div>
          )}
          <h3>Activity in this month</h3>
          {state.data.entries.length === 0 ? (
            <p>No activity recorded. Unknown amounts are not zero.</p>
          ) : (
            <ul className="review-entries">
              {state.data.entries.map((entry) => (
                <li key={entry.uuid}>
                  <time>{entry.financial_date}</time> · {entry.category} · {dollars(entry.amount)}
                  {entry.note && ` · ${entry.note}`}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
