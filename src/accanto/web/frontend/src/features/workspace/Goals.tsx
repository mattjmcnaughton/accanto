import { useState } from "react";
import { AccountPositions } from "./AccountPositions";
import { SavingsAccounts } from "./SavingsAccounts";
import { type Goal, completeGoal, dateLabel, goalSavings, id, money, today } from "./domain";
import { Empty, Icon, Modal, MoneyField, Notice, PageHead, type ViewProps } from "./ui";

export function Goals({
  state,
  update,
  openEntry,
  contribute,
}: ViewProps & { contribute: (sourceId: string) => void }) {
  const [editing, setEditing] = useState<Goal | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [inactive, setInactive] = useState(false);
  const visible = state.goals.filter((g) => inactive || g.active);
  const goal = state.goals.find((g) => g.id === detail);
  const progress = (goalId: string) => goalSavings(state, goalId).remaining;
  const goalEntries = state.entries
    .filter((e) => !e.deleted)
    .filter((e) => (e.kind === "saving" && e.sourceId === detail) || e.funding?.goalId === detail)
    .sort((a, b) => b.date.localeCompare(a.date));
  const add = () => setEditing({ id: id(), name: "", target: 0, tag: "", active: true });
  return (
    <>
      <PageHead
        title="Goals"
        description="Money set aside for the things that matter."
        actions={
          <button className="button primary" type="button" onClick={add}>
            <Icon name="plus" size={17} />
            New goal
          </button>
        }
      />
      <SavingsAccounts state={state} update={update} />
      <AccountPositions state={state} update={update} />
      {state.goals.some((g) => !g.active) && (
        <div className="filter-row">
          <label className="check-label">
            <input
              type="checkbox"
              checked={inactive}
              onChange={(e) => setInactive(e.target.checked)}
            />
            Show inactive goals
          </label>
        </div>
      )}
      {!visible.length ? (
        <section className="surface">
          <Empty
            icon="goals"
            title={state.goals.length ? "No active goals" : "Give your saving a purpose"}
            action={
              <button type="button" className="button primary" onClick={add}>
                Create a saving goal
              </button>
            }
          >
            An emergency fund, a trip, something you’ve been waiting for. Set a target, then record
            contributions as you go.
          </Empty>
        </section>
      ) : (
        <div className="goals-grid">
          {visible.map((g) => {
            const total = progress(g.id);
            const percent = g.target ? Math.round((total / g.target) * 100) : 0;
            return (
              <button
                key={g.id}
                className={`goal-card ${!g.active ? "inactive" : ""}`}
                type="button"
                onClick={() => setDetail(g.id)}
              >
                <div className="goal-card-top">
                  <span className="goal-symbol">
                    <Icon name="goals" size={22} />
                  </span>
                  <span className="pill">
                    {!g.active
                      ? "Inactive"
                      : total >= g.target && g.target > 0
                        ? "Target reached"
                        : "Saving"}
                  </span>
                </div>
                <h2>{g.name}</h2>
                <p>
                  {state.accounts?.find((a) => a.id === g.accountId)?.name ||
                    `Legacy account label: ${g.tag}`}
                </p>
                <div className="goal-amount">
                  <strong>{money(total)}</strong>
                  <span>of {money(g.target)}</span>
                </div>
                <div className="progress-track">
                  <span style={{ width: `${Math.min(100, percent)}%` }} />
                </div>
                <div className="goal-card-bottom">
                  <span>
                    {g.target ? `${percent}% funded` : "Ongoing · no target"} ·{" "}
                    {money(goalSavings(state, g.id).remaining)} remaining
                  </span>
                  <Icon name="arrow" size={16} />
                </div>
              </button>
            );
          })}
        </div>
      )}
      <p className="footnote">
        Remaining saved includes opening money and movements. Plans do not reserve savings.
      </p>
      {editing && (
        <GoalEditor
          goal={editing}
          accounts={state.accounts ?? []}
          onClose={() => setEditing(null)}
          save={(g) => {
            if (
              update(
                { ...state, goals: [...state.goals.filter((existing) => existing.id !== g.id), g] },
                "Goal saved",
              )
            ) {
              setEditing(null);
              return true;
            }
            return false;
          }}
        />
      )}
      {goal && (
        <Modal title={goal.name} onClose={() => setDetail(null)}>
          <div className="modal-body">
            <div className="goal-detail-total">
              <strong>{money(progress(goal.id))}</strong>
              <span>
                remaining saved {goal.target ? `toward ${money(goal.target)}` : "· no target"}
              </span>
            </div>
            <div className="detail-numbers">
              <div>
                <span>Savings used</span>
                <strong>{money(goalSavings(state, goal.id).used)}</strong>
              </div>
              <div>
                <span>Remaining saved</span>
                <strong>{money(goalSavings(state, goal.id).remaining)}</strong>
              </div>
            </div>
            {goalSavings(state, goal.id).remaining < 0 && (
              <Notice>
                Recorded uses exceed contributions. Check for missing saving history or incorrect
                funding origins.
              </Notice>
            )}
            {goal.tag && (
              <div className="tag-line">
                <Icon name="wallet" size={17} />
                {goal.tag}
                <span>Cash-account tag</span>
              </div>
            )}
            <div className="detail-actions">
              {goal.active && (
                <button
                  type="button"
                  className="button primary"
                  onClick={() => {
                    setDetail(null);
                    contribute(goal.id);
                  }}
                >
                  Add contribution
                </button>
              )}
              <button
                type="button"
                className="button secondary"
                onClick={() => {
                  if (!goal.accountId) {
                    window.alert(
                      "Legacy goal preserved. Create a new tracked goal; historical activity is not reassigned.",
                    );
                    return;
                  }
                  setEditing(goal);
                  setDetail(null);
                }}
              >
                <Icon name="edit" size={16} />
                Edit goal
              </button>
              {goal.role !== "unallocated" && !goal.completed && (
                <button
                  type="button"
                  className="button quiet"
                  onClick={() =>
                    update(
                      {
                        ...state,
                        goals: state.goals.map((g) =>
                          g.id === goal.id ? { ...g, active: !g.active } : g,
                        ),
                      },
                      goal.active ? "Goal made inactive; history kept" : "Goal reactivated",
                    )
                  }
                >
                  {goal.active ? "Make inactive" : "Reactivate"}
                </button>
              )}
              {goal.active && goal.purpose === "finite" && (
                <button
                  type="button"
                  onClick={() => {
                    try {
                      update(completeGoal(state, goal.id, today()), "Goal completed");
                    } catch (e) {
                      window.alert((e as Error).message);
                    }
                  }}
                >
                  Complete goal · return {money(goalSavings(state, goal.id).remaining)} to
                  Unallocated
                </button>
              )}
            </div>
            {!goal.active && (
              <Notice>
                This goal is inactive. Its history stays visible; reactivate it before recording a
                new contribution.
              </Notice>
            )}
            <h3>Contribution and use history</h3>
            {goalEntries.length ? (
              <div className="detail-entries">
                {goalEntries.map((e) => (
                  <button
                    type="button"
                    key={e.id}
                    onClick={() => {
                      setDetail(null);
                      openEntry(e);
                    }}
                  >
                    <span>
                      {e.note || "Contribution"}
                      <small>
                        {e.funding?.goalId === goal.id ? "Savings used" : "Contribution"}
                      </small>
                      <small>
                        {dateLabel(e.date)}, {e.date.slice(0, 4)}
                        {e.tag ? ` · ${e.tag}` : ""}
                      </small>
                    </span>
                    <strong>{money(e.amount, true)}</strong>
                    <Icon name="arrow" size={15} />
                  </button>
                ))}
              </div>
            ) : (
              <p className="subtle">
                No contributions yet. Record one using Add entry → Saving contribution.
              </p>
            )}
            <p className="footnote">
              Adjustment entries assigned to this goal count toward its progress.
            </p>
          </div>
        </Modal>
      )}
    </>
  );
}
function GoalEditor({
  goal,
  save,
  accounts,
  onClose,
}: {
  accounts: import("./domain").SavingsAccount[];
  goal: Goal;
  save: (g: Goal) => boolean;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(goal);
  const [error, setError] = useState("");
  return (
    <Modal
      title={goal.name ? "Edit goal" : "New saving goal"}
      onClose={() => {
        if (
          JSON.stringify(goal) === JSON.stringify(draft) ||
          window.confirm("Discard unsaved goal changes?")
        )
          onClose();
      }}
    >
      <form
        className="modal-body"
        onSubmit={(e) => {
          e.preventDefault();
          if (
            !draft.name.trim() ||
            !draft.accountId ||
            (draft.purpose !== "ongoing" && draft.target <= 0)
          ) {
            setError("Choose an account, name and a positive target for finite goals.");
            return;
          }
          save({
            ...draft,
            purpose: draft.purpose ?? "finite",
            name: draft.name.trim(),
            tag: draft.tag.trim(),
          });
        }}
      >
        <label className="field">
          <span>Goal name</span>
          <input
            required
            maxLength={120}
            placeholder="What are you saving for?"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </label>
        <MoneyField
          label="Target amount"
          value={draft.target}
          onChange={(n) => setDraft({ ...draft, target: n ?? 0 })}
        />
        <label className="field">
          <span>Savings account</span>
          <select
            disabled={Boolean(goal.accountId)}
            value={draft.accountId ?? ""}
            onChange={(e) => setDraft({ ...draft, accountId: e.target.value })}
          >
            <option value="">Choose account</option>
            {accounts
              .filter((a) => a.active)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
          </select>
        </label>
        <label className="field">
          <span>Purpose</span>
          <select
            disabled={draft.role === "unallocated"}
            value={draft.purpose ?? "finite"}
            onChange={(e) =>
              setDraft({ ...draft, purpose: e.target.value as "finite" | "ongoing" })
            }
          >
            <option value="finite">Finite</option>
            <option value="ongoing">Ongoing</option>
          </select>
        </label>
        {error && <Notice error>{error}</Notice>}
        <div className="modal-actions">
          <button className="button primary" type="submit">
            Save goal
          </button>
        </div>
      </form>
    </Modal>
  );
}
