import { type KeyboardEvent, useState } from "react";
import { USD_AMOUNT } from "../../lib/money";
import type { PlanRevision } from "../../lib/monthly";
import type { SavingsAccount } from "../../lib/savings";
import { FREQUENCIES, type Frequency } from "../workspace/planWorksheetModel";
import type { CreateRequest } from "./create";

/**
 * Enter creates and Esc cancels. These sit inside the record's own form, so they are not forms:
 * Enter here must not save the entry, and Esc must not close its dialog.
 */
const keys = (submit: () => void, cancel: () => void) => (e: KeyboardEvent) => {
  if (e.nativeEvent.isComposing) return;
  if (e.key === "Enter") {
    e.preventDefault();
    submit();
  } else if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    cancel();
  }
};

/**
 * A new Fixed cost is a new line in a Plan's draft, with its planned amount and frequency.
 * Saved versions, and the Reviews compared with them, keep what they had.
 */
export function NewFixedCost({
  name,
  drafts,
  busy,
  onCreate,
  onCancel,
}: {
  name: string;
  drafts: Array<{ planId: string; draft: PlanRevision }>;
  busy: boolean;
  onCreate: (request: CreateRequest) => void;
  onCancel: () => void;
}) {
  const [planId, setPlanId] = useState(drafts[0]?.planId ?? "");
  const [amount, setAmount] = useState("");
  const [frequency, setFrequency] = useState<Frequency>("Monthly");
  const [error, setError] = useState("");
  const plan = drafts.find((x) => x.planId === planId);
  const onKeyDown = keys(() => submit(), onCancel);
  const submit = () => {
    if (!plan) return;
    if (!USD_AMOUNT.test(amount.trim())) {
      setError("Enter a nonnegative USD amount with up to two decimal places.");
      return;
    }
    onCreate({ kind: "fixed_cost", name, planId, draft: plan.draft, amount, frequency });
  };
  if (!drafts.length)
    return (
      <fieldset className="create-form" aria-label={`New fixed cost ${name}`}>
        <p className="note">Create a Plan first, then add “{name}” to it.</p>
        <div className="create-form-actions">
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </fieldset>
    );
  return (
    <fieldset className="create-form" aria-label={`New fixed cost ${name}`}>
      <b>New fixed cost “{name}”</b>
      <p className="note">Joins the Plan&apos;s draft.</p>
      {drafts.length > 1 && (
        <label className="field">
          <span>Plan</span>
          <select value={planId} onKeyDown={onKeyDown} onChange={(e) => setPlanId(e.target.value)}>
            {drafts.map(({ planId, draft }) => (
              <option key={planId} value={planId}>
                {draft.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="two">
        <label className="field">
          <span>Planned amount (USD)</span>
          <input
            // biome-ignore lint/a11y/noAutofocus: The form opens to ask for this amount.
            autoFocus
            inputMode="decimal"
            placeholder="0.00"
            aria-invalid={Boolean(error)}
            onKeyDown={onKeyDown}
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              setError("");
            }}
          />
        </label>
        <label className="field">
          <span>Frequency</span>
          <select
            value={frequency}
            onKeyDown={onKeyDown}
            onChange={(e) => setFrequency(e.target.value as Frequency)}
          >
            {Object.keys(FREQUENCIES).map((label) => (
              <option key={label}>{label}</option>
            ))}
          </select>
        </label>
      </div>
      {error && (
        <p className="err" role="alert">
          {error}
        </p>
      )}
      <div className="create-form-actions">
        <button type="button" className="btn pri" disabled={busy} onClick={submit}>
          Add to {plan?.draft.name ?? "the Plan"}
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </fieldset>
  );
}

/** A new Saving goal names its savings account. It starts ongoing, with no target. */
export function NewGoal({
  name,
  accounts,
  busy,
  onCreate,
  onCancel,
}: {
  name: string;
  accounts: SavingsAccount[];
  busy: boolean;
  onCreate: (request: CreateRequest) => void;
  onCancel: () => void;
}) {
  const open = accounts.filter((account) => account.active);
  const [accountId, setAccountId] = useState(open[0]?.uuid ?? "");
  const account = open.find((x) => x.uuid === accountId);
  const submit = () => account && onCreate({ kind: "saving_goal", name, account });
  return (
    <fieldset className="create-form" aria-label={`New saving goal ${name}`}>
      <b>New saving goal “{name}”</b>
      {open.length ? (
        <>
          <label className="field">
            <span>Savings account</span>
            <select
              // biome-ignore lint/a11y/noAutofocus: The form opens to ask for the account.
              autoFocus
              value={accountId}
              onKeyDown={keys(submit, onCancel)}
              onChange={(e) => setAccountId(e.target.value)}
            >
              {open.map((x) => (
                <option key={x.uuid} value={x.uuid}>
                  {x.name}
                </option>
              ))}
            </select>
          </label>
        </>
      ) : (
        <p className="note">Open a savings account in Savings first.</p>
      )}
      <div className="create-form-actions">
        {open.length > 0 && (
          <button type="button" className="btn pri" disabled={busy} onClick={submit}>
            Create goal
          </button>
        )}
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </fieldset>
  );
}
