import { useState } from "react";
import { FundingFields } from "./EntryEditor";
import {
  type Entry,
  type Review,
  type ReviewLine,
  adjustActual,
  dateLabel,
  fundingLabel,
  goalSavings,
  money,
  monthLabel,
  reviewSignature,
  savingsUsed,
  shiftMonth,
  summarize,
  today,
  versions,
} from "./domain";
import { Empty, Icon, Modal, MoneyField, Notice, PageHead, type ViewProps } from "./ui";

export function Month({
  state,
  update,
  openEntry,
  month,
  setMonth,
  goPlans,
  goActivity,
  recordEntry,
}: ViewProps & {
  month: string;
  setMonth: (m: string) => void;
  goPlans: () => void;
  goActivity: () => void;
  recordEntry: (kind: import("./domain").Kind, sourceId: string) => void;
}) {
  const review = state.reviews.find((r) => r.month === month);
  const allVersions = versions(state);
  const version = allVersions.find((v) => v.id === review?.versionId);
  const [setup, setSetup] = useState(false);
  const [chosen, setChosen] = useState("");
  const [detail, setDetail] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string[]>([
    "income",
    "fixed",
    "saving",
    "investing",
    "giving",
  ]);
  const [finishing, setFinishing] = useState(false);
  const [notes, setNotes] = useState(false);
  const groups = review ? summarize(state, review) : [];
  const line = groups.flatMap((g) => [g, ...g.children]).find((g) => g.key === detail);
  const activity = state.entries
    .filter((e) => !e.deleted)
    .filter((e) => e.date.startsWith(month))
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  const known = groups.filter((g) => g.actual !== null && !g.incomplete).length;
  const missing = groups.filter((g) => g.actual === null || g.incomplete);
  const missingIncome = groups
    .find((g) => g.key === "income")
    ?.children.find((c) => c.actual === null);
  const reviewed = review?.checkpoint?.signature === (review ? reviewSignature(state, review) : "");
  const spending = groups.find((g) => g.key === "spending");
  const monthlyTotal =
    groups.every((g) => g.actual !== null && !g.incomplete) && groups.length
      ? (groups[0].actual ?? 0) - groups.slice(1).reduce((s, g) => s + (g.actual ?? 0), 0)
      : null;
  const selectedVersion =
    chosen ||
    review?.versionId ||
    state.reviews.find((r) => r.month === shiftMonth(month, -1))?.versionId ||
    "";
  function saveReview() {
    if (!allVersions.some((v) => v.id === selectedVersion)) return;
    const next: Review = {
      ...review,
      month,
      versionId: selectedVersion,
      note: review?.note ?? "",
    };
    if (
      update(
        { ...state, reviews: [...state.reviews.filter((r) => r.month !== month), next] },
        review ? "Comparison Plan changed; actuals kept" : "Monthly Review created",
      )
    )
      setSetup(false);
  }
  const renderLine = (item: ReviewLine, child = false) => {
    const group = groups.find((g) => g.key === item.key);
    const open = expanded.includes(item.key);
    const difference =
      group?.incomplete || item.actual === null || item.planned === null
        ? null
        : item.actual - item.planned;
    return (
      <tr key={item.key} className={child ? "child-row" : "group-row"}>
        <th scope="row">
          <div className="comparison-label">
            {!child && group?.children.length ? (
              <button
                type="button"
                className={`icon-button expand ${open ? "is-open" : ""}`}
                aria-label={`${open ? "Collapse" : "Expand"} ${item.name}`}
                aria-expanded={open}
                onClick={() =>
                  setExpanded((s) => (open ? s.filter((k) => k !== item.key) : [...s, item.key]))
                }
              >
                <Icon name="arrow" size={15} />
              </button>
            ) : !child ? (
              <span className={`category-dot ${item.key}`} />
            ) : null}
            <div>
              <button className="row-link" type="button" onClick={() => setDetail(item.key)}>
                {item.name}
              </button>
              {item.key !== "income" && item.entries.some((e) => e.funding) && (
                <small>
                  {money(savingsUsed(item.entries))} from savings ·{" "}
                  {money((item.recorded ?? 0) - savingsUsed(item.entries))} from current income
                </small>
              )}
              {item.actualOnly && <small>Actual-only activity</small>}
              {!child && (
                <small>
                  {item.actual === null
                    ? group?.known !== null && group?.incomplete
                      ? `${money(group?.known ?? null)} recorded · incomplete`
                      : "Not recorded"
                    : group?.incomplete
                      ? "Recorded so far · incomplete"
                      : "Recorded so far"}
                </small>
              )}
            </div>
          </div>
        </th>
        <td className="numeric planned">{money(item.planned)}</td>
        <td className="numeric">
          <button
            className={`actual-button ${item.actual === null ? "unknown" : ""}`}
            type="button"
            onClick={() => setDetail(item.key)}
            aria-label={`Inspect ${item.name} actual`}
          >
            {money(item.actual)}
          </button>
        </td>
        <td
          className={`numeric difference ${difference !== null && difference > 0 && ["fixed", "spending"].includes(item.key.split(":")[0]) ? "attention" : ""}`}
        >
          {difference === null ? "—" : `${difference > 0 ? "+" : ""}${money(difference)}`}
        </td>
      </tr>
    );
  };
  return (
    <>
      <PageHead
        title={monthLabel(month)}
        description="Your intentions, alongside what happened."
        actions={
          <>
            <div className="month-switch">
              <button
                type="button"
                className="icon-button"
                aria-label="Previous month"
                onClick={() => setMonth(shiftMonth(month, -1))}
              >
                <Icon name="back" size={17} />
              </button>
              <label className="sr-only" htmlFor="month-picker">
                Review month
              </label>
              <input
                id="month-picker"
                type="month"
                value={month}
                onChange={(e) => e.target.value && setMonth(e.target.value)}
              />
              <button
                type="button"
                className="icon-button"
                aria-label="Next month"
                onClick={() => setMonth(shiftMonth(month, 1))}
              >
                <Icon name="arrow" size={17} />
              </button>
            </div>
            {month !== today().slice(0, 7) && (
              <button
                className="button quiet"
                type="button"
                onClick={() => setMonth(today().slice(0, 7))}
              >
                Today
              </button>
            )}
          </>
        }
      />
      {!review ? (
        <div className="welcome-layout">
          <section className="surface">
            <Empty
              icon="month"
              title={allVersions.length ? "Give this month a Plan" : "Make room for what matters"}
              action={
                <button
                  type="button"
                  className="button primary"
                  onClick={() => (allVersions.length ? setSetup(true) : goPlans())}
                >
                  <Icon name="plus" size={17} />
                  {allVersions.length ? "Start monthly Review" : "Create your first Plan"}
                </button>
              }
            >
              {allVersions.length
                ? "Choose a saved Plan to compare with this month’s activity. You can change the comparison later."
                : "Start with your income and recurring costs. Then decide what goes toward giving, spending, saving, and investing."}
            </Empty>
          </section>
          <aside className="onboarding-aside">
            <h2>A simple monthly rhythm</h2>
            <div>
              <Icon name="plans" />
              <section>
                <h3>Set your intentions</h3>
                <p>A saved Plan keeps a clear starting point.</p>
              </section>
            </div>
            <div>
              <Icon name="activity" />
              <section>
                <h3>Record as you go</h3>
                <p>Receipts, payments, and contributions stay together.</p>
              </section>
            </div>
            <div>
              <Icon name="month" />
              <section>
                <h3>See what changed</h3>
                <p>Compare the month without rewriting your Plan.</p>
              </section>
            </div>
            {activity.length > 0 && (
              <Notice>
                {activity.length} entries are already recorded for this month. They will appear when
                you start its Review.
              </Notice>
            )}
          </aside>
        </div>
      ) : (
        <>
          <div className="context-bar">
            <div>
              <span className="status-dot" />
              <span>
                Comparing with{" "}
                <button
                  type="button"
                  className="text-button"
                  onClick={() => {
                    setChosen(review.versionId);
                    setSetup(true);
                  }}
                >
                  {version?.plan.name} <span className="version-tag">v{version?.number}</span>
                  <Icon name="down" size={14} />
                </button>
              </span>
            </div>
            <div>
              <button type="button" className="button quiet" onClick={() => setNotes(true)}>
                <Icon name="edit" size={16} />
                {review.note ? "Review notes" : "Add a note"}
              </button>
            </div>
          </div>
          {version?.plan.cadence === "yearly" && (
            <div className="inline-note">
              This yearly Plan is shown as monthly equivalents. Actuals belong to this month.
            </div>
          )}
          <section className="month-guidance" aria-label="Next steps">
            <div className="guidance-heading">
              <div>
                <h2>
                  {reviewed
                    ? "Reviewed for now"
                    : review.checkpoint
                      ? "Changes since your last review"
                      : "Your next steps"}
                </h2>
                <p>
                  {reviewed
                    ? "You can keep recording activity. Later changes will flag this month for another look."
                    : review.checkpoint
                      ? "Activity, notes or the comparison changed. Take another look when you’re ready."
                      : month === today().slice(0, 7)
                        ? "This month is in progress. These totals reflect only what you’ve recorded."
                        : "Check the recorded activity, then capture what you want to carry forward."}
                </p>
              </div>
              <button type="button" className="button secondary" onClick={() => setFinishing(true)}>
                {reviewed ? "Review again" : "Wrap up Review"}
              </button>
            </div>
            <div className="next-actions">
              {missing.length > 0 && (
                <button
                  type="button"
                  onClick={() => setDetail(missingIncome?.key ?? missing[0].key)}
                >
                  <Icon name="activity" size={18} />
                  <span>
                    <strong>
                      {missingIncome
                        ? `${missingIncome.name} income is unrecorded`
                        : `${missing[0].name} is unrecorded`}
                    </strong>
                    <small>
                      {missing.length} category totals unknown or incomplete. Record activity or
                      confirm a known total.
                    </small>
                  </span>
                  <Icon name="arrow" size={15} />
                </button>
              )}
              {spending?.actual !== null && (spending?.actual ?? 0) > (spending?.planned ?? 0) && (
                <button type="button" onClick={() => setDetail("spending")}>
                  <Icon name="spending" size={18} />
                  <span>
                    <strong>
                      {money((spending?.actual ?? 0) - (spending?.planned ?? 0))} above your
                      spending Plan
                    </strong>
                    <small>
                      {money(savingsUsed(spending?.entries ?? []))} funded from savings. Inspect the
                      entries before changing your Plan.
                    </small>
                  </span>
                  <Icon name="arrow" size={15} />
                </button>
              )}
              {!!version && version.calculation.unassigned !== 0 && (
                <button type="button" onClick={goPlans}>
                  <Icon name="plans" size={18} />
                  <span>
                    <strong>
                      {money(Math.abs(version.calculation.unassigned))}{" "}
                      {version.calculation.unassigned > 0
                        ? "unassigned in the Plan"
                        : "overallocated in the Plan"}
                    </strong>
                    <small>
                      Review your allocations. This is a planning amount, not available cash.
                    </small>
                  </span>
                  <Icon name="arrow" size={15} />
                </button>
              )}
              {!missing.length && (
                <button type="button" onClick={goActivity}>
                  <Icon name="check" size={18} />
                  <span>
                    <strong>All six totals have recorded amounts</strong>
                    <small>Check for missing entries before wrapping up.</small>
                  </span>
                  <Icon name="arrow" size={15} />
                </button>
              )}
            </div>
          </section>
          <div className="month-layout">
            <div>
              <section className="surface comparison">
                <div className="section-title">
                  <h2>Plan & actual</h2>
                  <span className="subtle">{known} of 6 totals recorded</span>
                </div>
                <table>
                  <thead>
                    <tr>
                      <th>Category</th>
                      <th className="numeric">Plan</th>
                      <th className="numeric">Actual</th>
                      <th className="numeric difference">Difference</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groups.flatMap((g) => [
                      renderLine(g),
                      ...(expanded.includes(g.key)
                        ? g.children.map((c) => renderLine(c, true))
                        : []),
                    ])}
                  </tbody>
                </table>
                <div className="comparison-footer">
                  <span>
                    <span className="legend-dash">—</span> Unknown, not zero Adjustments are
                    included in recorded entries.
                  </span>
                  <span>Amounts in USD</span>
                </div>
              </section>
              {version?.plan.override !== null && (
                <p className="footnote">
                  The Plan uses a take-home override. Source estimates remain visible; they may not
                  add up to the overridden total.
                </p>
              )}
              <section className="surface recent-section">
                <div className="section-title">
                  <h2>Recent activity</h2>
                  <button type="button" className="text-button" onClick={goActivity}>
                    View all <Icon name="arrow" size={15} />
                  </button>
                </div>
                {activity.length ? (
                  activity.slice(0, 4).map((e) => (
                    <button
                      type="button"
                      key={e.id}
                      className="recent-entry"
                      onClick={() => openEntry(e)}
                    >
                      <span className={`entry-icon ${e.kind}`}>
                        <Icon
                          name={
                            e.kind === "saving"
                              ? "goals"
                              : e.kind === "income"
                                ? "wallet"
                                : "activity"
                          }
                          size={17}
                        />
                      </span>
                      <span className="entry-description">
                        <strong>
                          {e.adjustment && <small>Adjustment</small>}
                          {e.note || e.label}
                        </strong>
                        <small>
                          {e.label} · {dateLabel(e.date)}
                        </small>
                      </span>
                      <strong className="numeric">
                        {e.kind === "income" ? "+" : ""}
                        {money(e.amount, true)}
                      </strong>
                    </button>
                  ))
                ) : (
                  <div className="small-empty">
                    Nothing recorded yet.
                    <button type="button" className="text-button" onClick={() => openEntry()}>
                      Add an entry
                    </button>
                  </div>
                )}
              </section>
            </div>
            <aside className="month-aside">
              <section className="spending-focus">
                <div className="focus-label">
                  <span className="category-dot spending" />
                  Guilt-free spending
                </div>
                <span className="focus-amount">
                  {spending?.actual === null
                    ? "—"
                    : money(Math.abs((spending?.planned ?? 0) - (spending?.actual ?? 0)))}
                </span>
                <p>
                  {spending?.actual === null
                    ? "Record spending to see what’s left of your allocation."
                    : (spending?.actual ?? 0) > (spending?.planned ?? 0)
                      ? "above your monthly allocation"
                      : "left of your monthly allocation, based on recorded activity"}
                </p>
                <div className="progress-track">
                  <span
                    style={{
                      width: `${Math.min(100, Math.max(0, ((spending?.actual ?? 0) / (spending?.planned || 1)) * 100))}%`,
                    }}
                  />
                </div>
                <div className="progress-labels">
                  <span>{money(spending?.actual ?? null)} recorded</span>
                  <span>{money(spending?.planned ?? null)} planned</span>
                </div>
              </section>
              <section className="aside-section">
                <h2>Recorded saving</h2>
                <p>
                  New saving from income:{" "}
                  {money(groups.find((g) => g.key === "saving")?.actual ?? null)}
                </p>
                <p>
                  Net saving = new saving − savings used:{" "}
                  {groups.find((g) => g.key === "saving")?.actual === null ||
                  groups.find((g) => g.key === "saving")?.incomplete
                    ? "Unavailable (saving incomplete)"
                    : money(
                        (groups.find((g) => g.key === "saving")?.actual ?? 0) -
                          savingsUsed(activity),
                      )}
                </p>
              </section>
              <section className="aside-section">
                <h2>Saving goals</h2>
                {state.goals.filter((g) => g.active).length ? (
                  state.goals
                    .filter((g) => g.active)
                    .slice(0, 4)
                    .map((g) => {
                      const total = goalSavings(state, g.id).remaining;
                      return (
                        <div className="mini-goal" key={g.id}>
                          <div>
                            <strong>{g.name}</strong>
                            <span>
                              {g.target
                                ? `${Math.round((total / g.target) * 100)}% funded`
                                : "No target"}
                            </span>
                          </div>
                          <div className="progress-track">
                            <span
                              style={{
                                width: `${g.target ? Math.min(100, (total / g.target) * 100) : 0}%`,
                              }}
                            />
                          </div>
                          <small>
                            Remaining ÷ target: {money(total)} ÷{" "}
                            {g.target ? money(g.target) : "not set"} ·{" "}
                            {money(goalSavings(state, g.id).remaining)} remaining
                          </small>
                        </div>
                      );
                    })
                ) : (
                  <p className="subtle">Your active goals will appear here.</p>
                )}
              </section>
              <section className="aside-section recorded-net">
                <span>Savings used this month</span>
                <strong>{money(savingsUsed(activity))}</strong>
                <p>
                  Funding for recorded outflows; not new income. Refunds and corrections are
                  included.
                </p>
                <span>Recorded net cash flow</span>
                <strong>{money(monthlyTotal)}</strong>
                <p>
                  {monthlyTotal === null
                    ? "Some actuals are still unknown."
                    : "Based on this Review’s actuals, including adjustment entries."}{" "}
                  This is not an account balance.
                </p>
              </section>
            </aside>
          </div>
        </>
      )}
      {finishing && review && (
        <FinishReview
          review={review}
          unknown={missing.length}
          onClose={() => setFinishing(false)}
          save={(note) => {
            const next = { ...review, note };
            next.checkpoint = {
              at: new Date().toISOString(),
              signature: reviewSignature(state, next),
            };
            if (
              update(
                { ...state, reviews: state.reviews.map((r) => (r.month === month ? next : r)) },
                "Reviewed for now; this month stays editable",
              )
            )
              setFinishing(false);
          }}
        />
      )}
      {setup && (
        <Modal
          title={review ? "Change comparison Plan" : "Start monthly Review"}
          onClose={() => setSetup(false)}
        >
          <div className="modal-body">
            <p className="subtle">{monthLabel(month)} · Actuals stay attached to this month.</p>
            <label className="field">
              <span>Saved Plan version</span>
              <select value={selectedVersion} onChange={(e) => setChosen(e.target.value)}>
                <option value="">Choose a saved version</option>
                {state.plans.map((p) => (
                  <optgroup key={p.id} label={p.draft.name}>
                    {p.versions.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.plan.name} · v{v.number}
                        {v.plan.cadence === "yearly" ? " · monthly equivalent" : ""}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            {review && (
              <Notice>
                Only the planned comparison changes. Recorded entries stay visible, including
                activity absent from the selected Plan.
              </Notice>
            )}
            <div className="modal-actions">
              <button type="button" className="button secondary" onClick={() => setSetup(false)}>
                Cancel
              </button>
              <button type="button" className="button primary" onClick={saveReview}>
                {review ? "Change comparison" : "Start Review"}
              </button>
            </div>
          </div>
        </Modal>
      )}
      {line && review && (
        <ActualDetail
          key={line.key}
          line={line}
          review={review}
          state={state}
          update={update}
          openEntry={(e) => {
            setDetail(null);
            openEntry(e);
          }}
          record={() => {
            const [kind, sourceId = ""] = line.key.split(":");
            setDetail(null);
            recordEntry(kind as import("./domain").Kind, sourceId);
          }}
          onClose={() => setDetail(null)}
        />
      )}
      {notes && review && (
        <ReviewNotes
          review={review}
          onClose={() => setNotes(false)}
          save={(note) =>
            update(
              {
                ...state,
                reviews: state.reviews.map((r) => (r.month === month ? { ...r, note } : r)),
              },
              "Review note saved",
            )
          }
        />
      )}
    </>
  );
}

function ActualDetail({
  line,
  review,
  state,
  update,
  openEntry,
  onClose,
  record,
}: ViewProps & { record: () => void; line: ReviewLine; review: Review; onClose: () => void }) {
  const [adjustmentDate, setAdjustmentDate] = useState(`${review.month}-01`);
  const [savingGoalId, setSavingGoalId] = useState(line.key.split(":")[1] ?? "");
  const [total, setTotal] = useState<number | null>(line.recorded);
  const [funding, setFunding] = useState<Entry["funding"]>();
  const [error, setError] = useState("");
  return (
    <Modal title={line.name} onClose={onClose}>
      <div className="modal-body">
        <div className="detail-numbers">
          <div>
            <span>Recorded detail</span>
            <strong>{money(line.recorded)}</strong>
          </div>
          <div>
            <span>Review actual</span>
            <strong>{money(line.actual)}</strong>
          </div>
        </div>
        <div className="section-title">
          <h3>Contributing entries</h3>
          <button type="button" className="text-button" onClick={record}>
            Record activity
          </button>
        </div>
        {line.entries.length ? (
          <div className="detail-entries">
            {line.entries.map((e) => (
              <button type="button" key={e.id} onClick={() => openEntry(e)}>
                <span>
                  {e.adjustment && <small>Adjustment</small>}
                  {e.note || e.label}
                  <small>
                    {dateLabel(e.date)}
                    {e.kind !== "income" ? ` · From ${fundingLabel(state, e)}` : ""}
                  </small>
                </span>
                <strong>{money(e.amount, true)}</strong>
                <Icon name="arrow" size={15} />
              </button>
            ))}
          </div>
        ) : (
          <p className="subtle">No dated entries for this item.</p>
        )}
        <div className="adjustment-section">
          <h3>Adjust the recorded total</h3>
          <p>
            Create a dated entry for the difference. Existing entries stay unchanged. Later receipts
            add to this total; edit or delete the adjustment if they cover the same money.
          </p>
          <label className="field">
            <span>Adjustment date</span>
            <input
              type="date"
              value={adjustmentDate}
              onChange={(e) => setAdjustmentDate(e.target.value)}
            />
          </label>
          {line.key === "saving" && (
            <label className="field">
              <span>Adjustment saving goal</span>
              <select value={savingGoalId} onChange={(e) => setSavingGoalId(e.target.value)}>
                <option value="">Choose goal explicitly</option>
                {state.goals
                  .filter((g) => g.accountId && g.active)
                  .map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
              </select>
            </label>
          )}
          <MoneyField label="Known total" value={total} onChange={setTotal} optional signed />
          <p>
            Adjustment: {money(total === null ? null : total - (line.recorded ?? 0), true)} · dated{" "}
            {adjustmentDate}
          </p>
          {!line.key.startsWith("income") && !line.key.startsWith("saving") && (
            <FundingFields
              state={state}
              funding={funding}
              onChange={setFunding}
              amount={(total ?? 0) - (line.recorded ?? 0)}
            />
          )}
          <p className="footnote">
            Choose the origin affected by this correction; it does not change other entries’
            origins. Enter 0 to record an explicit zero. A category adjustment does not resolve
            unknown individual items. Assign saving adjustments to a goal to update its progress.
          </p>
        </div>
        {error && <Notice error>{error}</Notice>}
        <div className="modal-actions">
          <button
            type="button"
            className="button primary"
            disabled={total === null}
            onClick={() => {
              try {
                if (
                  total !== null &&
                  update(
                    adjustActual(
                      state,
                      review.month,
                      line.key,
                      total,
                      funding,
                      adjustmentDate,
                      savingGoalId,
                    ),
                    "Adjustment entry recorded",
                  )
                )
                  onClose();
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            Add adjustment
          </button>
        </div>
      </div>
    </Modal>
  );
}
function ReviewNotes({
  review,
  save,
  onClose,
}: { review: Review; save: (note: string) => boolean; onClose: () => void }) {
  const [note, setNote] = useState(review.note);
  return (
    <Modal title="Review notes" onClose={onClose}>
      <form
        className="modal-body"
        onSubmit={(e) => {
          e.preventDefault();
          if (save(note)) onClose();
        }}
      >
        <label className="field">
          <span>{monthLabel(review.month)}</span>
          <textarea
            rows={6}
            maxLength={4000}
            placeholder="What would you like to remember about this month?"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        <div className="modal-actions">
          <button className="button primary" type="submit">
            Save note
          </button>
        </div>
      </form>
    </Modal>
  );
}

function FinishReview({
  review,
  unknown,
  save,
  onClose,
}: { review: Review; unknown: number; save: (note: string) => void; onClose: () => void }) {
  const [note, setNote] = useState(review.note);
  return (
    <Modal
      title="Wrap up your monthly Review"
      onClose={() => {
        if (note === review.note || window.confirm("Discard your unsaved takeaway?")) onClose();
      }}
    >
      <form
        className="modal-body"
        onSubmit={(e) => {
          e.preventDefault();
          save(note);
        }}
      >
        <p className="subtle">{monthLabel(review.month)} · A checkpoint, not a lock.</p>
        <ol className="review-steps">
          <li>Check receipts, payments and contributions.</li>
          <li>Look at the differences from your Plan.</li>
          <li>Capture one thing to carry into next month.</li>
        </ol>
        {unknown > 0 && (
          <Notice>
            {unknown} category totals are unknown or incomplete. This checkpoint preserves those
            gaps; it does not turn them into zero.
          </Notice>
        )}
        <label className="field">
          <span>
            What will you carry forward? <span className="optional">optional</span>
          </span>
          <textarea
            rows={3}
            maxLength={4000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="A choice to repeat, a surprise, or a change for next month."
          />
        </label>
        <div className="modal-actions">
          <button type="submit" className="button primary">
            Mark reviewed for now
          </button>
        </div>
      </form>
    </Modal>
  );
}
