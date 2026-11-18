import { useState } from "react";
import { type Observation, type ObservationInput, balances } from "../../lib/balances";
import {
  type Contribution,
  type ContributionInput,
  type Destination,
  type DestinationKind,
  destinations,
} from "../../lib/destinations";
import { savings } from "../../lib/savings";
import { LoadMessage, MoneyInput, type ScreenProps, dollars, useLoad } from "../workspace/shared";
import {
  type Column,
  type Confirmation,
  ConfirmDialog,
  RecordGrid,
  Shortcuts,
  StatusBar,
  amountClass,
  dash,
  modeFor,
  useRecordEditor,
  validMoney,
} from "./records";

type DestinationForm = {
  name: string;
  target: string;
  active: boolean;
  openingDate: string;
  openingAmount: string;
};
type Form =
  | { type: "destination"; record: Destination | null; value: DestinationForm }
  | { type: "entry"; record: Contribution | null; value: ContributionInput }
  | { type: "observation"; record: Observation | null; value: ObservationInput };

function problem(form: Form): string {
  if (form.type === "destination") {
    const d = form.value;
    if (!d.name.trim()) return "Enter a name.";
    if (d.target && !validMoney(d.target))
      return "Enter the target as USD with up to two decimals.";
    if (d.openingAmount && (!validMoney(d.openingAmount) || !d.openingDate))
      return "Enter an opening date and a USD opening value with up to two decimals.";
    return "";
  }
  if (!form.value.date) return "Enter a date.";
  if (form.type === "entry") {
    const e = form.value;
    if (!validMoney(e.amount, e.is_adjustment))
      return e.is_adjustment
        ? "Enter a signed USD amount with up to two decimals."
        : "Enter a nonnegative USD amount with up to two decimals.";
    if (e.funding_origin === "savings" && !e.saving_goal_id) return "Choose a saving goal.";
    return "";
  }
  return validMoney(form.value.amount)
    ? ""
    : "Enter a nonnegative USD value with up to two decimals.";
}

export function Destinations(p: ScreenProps) {
  const [kind, setKind] = useState<DestinationKind>("investment");
  const [reload, setReload] = useState(0);
  const again = () => setReload((value) => value + 1);
  const rows = useLoad(
    () => destinations.list(p.entity.id, kind),
    [p.entity.id, kind, p.refresh, reload],
  );
  const history = useLoad(
    () => destinations.history(p.entity.id, kind),
    [p.entity.id, kind, p.refresh, reload],
  );
  const observed = useLoad(
    () =>
      kind === "investment"
        ? balances.list(p.entity.id, "investment")
        : Promise.resolve({ kind: "empty" as const }),
    [p.entity.id, kind, p.refresh, reload],
  );
  const accounts = useLoad(() => savings.list(p.entity.id), [p.entity.id, p.refresh, reload]);
  const editor = useRecordEditor<Form>(p, again);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [help, setHelp] = useState(false);
  const [notice, setNotice] = useState("");
  const [mode, setMode] = useState("READY");
  const named = rows.kind === "ready" ? rows.data : [];
  const entries = history.kind === "ready" ? history.data : [];
  const observations = observed.kind === "ready" ? observed.data : [];
  const savingGoals =
    accounts.kind === "ready"
      ? accounts.data.flatMap((account) =>
          account.goals.map((goal) => ({ account, goal, label: `${account.name} · ${goal.name}` })),
        )
      : [];
  const investment = kind === "investment";
  const noun = investment ? "investment" : "recipient";
  const nameOf = (id: string | null) =>
    named.find((item) => item.uuid === id)?.name ?? "Unassigned";
  const draft = editor.draft;
  const form = draft?.form;
  const set = <V,>(patch: Partial<V>) =>
    editor.update((current) => ({ ...current, value: { ...current.value, ...patch } }) as Form);
  const showHelp = () => setHelp(true);

  function editDestination(row: Destination | null) {
    editor.start(`destination:${row?.uuid ?? "new"}`, {
      type: "destination",
      record: row,
      value: row
        ? {
            name: row.name,
            target: row.target ?? "",
            active: row.active,
            openingDate: row.opening?.date ?? p.entity.today,
            openingAmount: row.opening?.amount ?? "",
          }
        : { name: "", target: "", active: true, openingDate: p.entity.today, openingAmount: "" },
    });
  }
  function editEntry(row: Contribution | null) {
    if (row?.is_refund) {
      setNotice("Correct this linked refund in Activity.");
      return;
    }
    editor.start(`entry:${row?.uuid ?? "new"}`, {
      type: "entry",
      record: row,
      value: row
        ? {
            date: row.financial_date,
            amount: row.amount,
            destination_id: row.destination_id,
            note: row.note,
            is_adjustment: row.is_adjustment,
            expected_revision: row.revision,
            funding_origin: row.funding_origin ?? "income",
            saving_goal_id: row.saving_goal_id ?? null,
          }
        : {
            date: p.entity.today,
            amount: "",
            destination_id: null,
            note: "",
            is_adjustment: false,
            funding_origin: "income",
            saving_goal_id: null,
          },
    });
  }
  function editObservation(row: Observation | null) {
    if (row?.is_opening) {
      setNotice("An opening value is set when the investment is added and cannot be corrected.");
      return;
    }
    editor.start(`observation:${row?.uuid ?? "new"}`, {
      type: "observation",
      record: row,
      value: row
        ? {
            date: row.financial_date,
            amount: row.amount,
            account_id: row.account_id,
            expected_revision: row.revision,
          }
        : { date: p.entity.today, amount: "", account_id: null },
    });
  }
  function confirmDelete(what: string, run: () => void) {
    if (draft?.changed) {
      setNotice("Save or discard the unsaved edit before deleting another record.");
      return;
    }
    setConfirmation({
      title: `Delete ${what}?`,
      message: "Use this for a mistaken record. Its history is retained.",
      action: `Delete ${what}`,
      run,
    });
  }
  function removeEntry(row: Contribution) {
    if (row.is_refund) {
      setNotice("Correct this linked refund in Activity.");
      return;
    }
    confirmDelete("entry", () =>
      p.save(destinations.remove(p.entity.id, kind, row.uuid, row.revision), editor.saved),
    );
  }
  function removeObservation(row: Observation) {
    if (row.is_opening) {
      setNotice("Opening values cannot be deleted.");
      return;
    }
    confirmDelete("observation", () =>
      p.save(balances.remove(p.entity.id, "investment", row.uuid, row.revision), editor.saved),
    );
  }
  function save() {
    if (!form) return;
    const error = problem(form);
    if (form.type === "destination") {
      const v = form.value;
      const target = v.target.trim() || null;
      editor.submit(
        error,
        form.record
          ? destinations.edit(p.entity.id, kind, form.record.uuid, {
              name: v.name.trim(),
              target,
              active: v.active,
              expected_revision: form.record.revision,
            })
          : destinations.create(p.entity.id, kind, {
              name: v.name.trim(),
              target,
              opening:
                investment && v.openingAmount
                  ? { date: v.openingDate, amount: v.openingAmount.trim() }
                  : null,
            }),
      );
    } else if (form.type === "entry") {
      const v = { ...form.value, amount: form.value.amount.trim() };
      editor.submit(
        error,
        form.record
          ? destinations.correct(p.entity.id, kind, form.record.uuid, v)
          : destinations.record(p.entity.id, kind, v),
      );
    } else {
      const v = { ...form.value, amount: form.value.amount.trim() };
      editor.submit(
        error,
        form.record
          ? balances.correct(p.entity.id, "investment", form.record.uuid, v)
          : balances.create(p.entity.id, "investment", v),
      );
    }
  }

  if (p.concealed) return null;

  const destinationColumns: Column<Destination>[] = [
    { header: "Name", cell: (row) => row.name },
    { header: "Status", cell: (row) => (row.active ? "Active" : "Inactive") },
    {
      header: investment ? "Contributions" : "Net donations",
      numeric: true,
      cell: (row) => dollars(row.contribution_progress),
    },
    {
      header: "Target",
      numeric: true,
      cell: (row) => (row.target ? dollars(row.target) : dash),
    },
    ...(investment
      ? [
          {
            header: "Latest observed value",
            numeric: true,
            cell: (row: Destination) =>
              row.latest ? dollars(row.latest.amount) : <span className="muted">None</span>,
          },
          { header: "Observed on", cell: (row: Destination) => row.latest?.date ?? dash },
        ]
      : []),
    {
      header: "",
      cell: (row) => (
        <button
          type="button"
          tabIndex={-1}
          aria-label={`Edit ${row.name}`}
          onClick={() => editDestination(row)}
        >
          Edit
        </button>
      ),
    },
  ];
  const entryColumns: Column<Contribution>[] = [
    { header: "Date", cell: (row) => <time>{row.financial_date}</time> },
    { header: investment ? "Investment" : "Recipient", cell: (row) => nameOf(row.destination_id) },
    {
      header: "Kind",
      cell: (row) =>
        row.is_refund
          ? "Refund"
          : row.is_adjustment
            ? "Adjustment"
            : investment
              ? "Contribution"
              : "Donation",
    },
    {
      header: "Funded from",
      cell: (row) =>
        row.funding_origin === "savings"
          ? (savingGoals.find(({ goal }) => goal.uuid === row.saving_goal_id)?.label ??
            "Historical saving goal")
          : "Income",
    },
    {
      header: "Amount",
      numeric: true,
      cell: (row) => <span className={amountClass(row.amount)}>{dollars(row.amount)}</span>,
    },
    { header: "Note", cell: (row) => <span className="note">{row.note}</span> },
    {
      header: "",
      cell: (row) =>
        row.is_refund ? (
          <span className="muted">Correct in Activity</span>
        ) : (
          <button
            type="button"
            tabIndex={-1}
            aria-label={`Correct entry on ${row.financial_date}`}
            onClick={() => editEntry(row)}
          >
            Correct
          </button>
        ),
    },
  ];
  const observationColumns: Column<Observation>[] = [
    { header: "Date", cell: (row) => <time>{row.financial_date}</time> },
    { header: "Investment", cell: (row) => nameOf(row.account_id) },
    { header: "Observed value", numeric: true, cell: (row) => dollars(row.amount) },
    { header: "Kind", cell: (row) => (row.is_opening ? "Opening" : "Observation") },
    {
      header: "",
      cell: (row) =>
        row.is_opening ? null : (
          <button
            type="button"
            tabIndex={-1}
            aria-label={`Correct observation on ${row.financial_date}`}
            onClick={() => editObservation(row)}
          >
            Correct
          </button>
        ),
    },
  ];
  const marked = draft?.changed ? draft.key.split(":")[1] : null;
  const markedIn = (type: Form["type"]) => (form?.type === type ? marked : null);

  return (
    <section
      aria-labelledby="destinations-title"
      className="data-workspace records"
      onFocus={(event) => setMode(modeFor(event))}
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
          event.preventDefault();
          save();
        }
        if (
          event.key === "Escape" &&
          form &&
          draft?.open &&
          (event.target as HTMLElement).closest("[role=grid]")
        ) {
          event.preventDefault();
          editor.close(problem(form));
        }
      }}
    >
      <div className="data-toolbar">
        <h2 id="destinations-title">Investments and giving</h2>
        <fieldset className="segmented">
          <legend className="sr-only">Destination type</legend>
          {(["investment", "giving"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={kind === value}
              disabled={p.busy}
              onClick={() => {
                if (kind !== value && p.guard()) {
                  setKind(value);
                  setNotice("");
                  editor.reset();
                }
              }}
            >
              {value === "investment" ? "Investments" : "Giving recipients"}
            </button>
          ))}
        </fieldset>
        {draft?.changed && !draft.open && (
          <output className="pending">
            Unsaved edit
            <button type="button" onClick={() => editor.start(draft.key, draft.form)}>
              Review
            </button>
            <button type="button" className="primary" disabled={p.busy} onClick={save}>
              Save
            </button>
            <button type="button" disabled={p.busy} onClick={editor.discard}>
              Discard
            </button>
          </output>
        )}
      </div>
      <p className="annotation muted">
        {investment
          ? "Contributions count money added. Observed value is a dated reading, not contribution progress."
          : "Net donations include refunds. Recording giving does not establish tax deductibility."}
      </p>
      {notice && (
        <output className="notice">
          {notice}
          <button type="button" aria-label="Dismiss message" onClick={() => setNotice("")}>
            ×
          </button>
        </output>
      )}
      <LoadMessage state={rows} retry={again} />
      <LoadMessage state={history} retry={again} />
      <LoadMessage state={observed} retry={again} />
      <div className={`data-layout${draft?.open ? " with-sidebar" : ""}`}>
        <div className="record-tables">
          <div className="table-heading">
            <h3>{investment ? "Investments" : "Giving recipients"}</h3>
            <button type="button" disabled={p.busy} onClick={() => editDestination(null)}>
              Add {noun}
            </button>
          </div>
          {(rows.kind === "ready" || rows.kind === "empty") && (
            <RecordGrid
              label={investment ? "Investments" : "Giving recipients"}
              rows={named}
              rowId={(row) => row.uuid}
              columns={destinationColumns}
              empty={`No ${noun}s yet. Press a to add one.`}
              marked={markedIn("destination")}
              edit={editDestination}
              add={() => editDestination(null)}
              help={showHelp}
            />
          )}
          <div className="table-heading">
            <h3>{investment ? "Contributions" : "Donations"}</h3>
            <button type="button" disabled={p.busy} onClick={() => editEntry(null)}>
              Record contribution
            </button>
          </div>
          {(history.kind === "ready" || history.kind === "empty") && (
            <RecordGrid
              label={investment ? "Investment contributions" : "Donations"}
              rows={entries}
              rowId={(row) => row.uuid}
              columns={entryColumns}
              empty={`No recorded ${investment ? "contributions" : "donations"} yet.`}
              marked={markedIn("entry")}
              edit={editEntry}
              add={() => editEntry(null)}
              remove={removeEntry}
              help={showHelp}
            />
          )}
          {investment && (
            <>
              <div className="table-heading">
                <h3>Observed values</h3>
                <button type="button" disabled={p.busy} onClick={() => editObservation(null)}>
                  Record observation
                </button>
              </div>
              {(observed.kind === "ready" || observed.kind === "empty") && (
                <RecordGrid
                  label="Investment value observations"
                  rows={observations}
                  rowId={(row) => row.uuid}
                  columns={observationColumns}
                  empty="No observed values yet."
                  marked={markedIn("observation")}
                  edit={editObservation}
                  add={() => editObservation(null)}
                  remove={removeObservation}
                  help={showHelp}
                />
              )}
            </>
          )}
        </div>
        {draft?.open && form && (
          <aside
            ref={editor.aside}
            className="data-sidebar"
            aria-label="Record details"
            onKeyDown={(event) => {
              if (event.key === "Escape" && !(event.target instanceof HTMLSelectElement)) {
                event.preventDefault();
                editor.close(problem(form));
              }
            }}
          >
            <form
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                editor.close(problem(form));
              }}
            >
              <fieldset disabled={p.busy}>
                {form.type === "destination" && (
                  <DestinationFields
                    kind={kind}
                    record={form.record}
                    value={form.value}
                    set={set<DestinationForm>}
                  />
                )}
                {form.type === "entry" && (
                  <EntryFields
                    record={form.record}
                    value={form.value}
                    set={set<ContributionInput>}
                    destinations={named}
                    goals={savingGoals}
                  />
                )}
                {form.type === "observation" && (
                  <>
                    <legend>
                      {form.record ? "Correct observed value" : "Record observed value"}
                    </legend>
                    <label>
                      Investment
                      <select
                        value={form.value.account_id ?? ""}
                        onChange={(event) =>
                          set<ObservationInput>({ account_id: event.target.value || null })
                        }
                      >
                        <option value="">Unassigned</option>
                        {named.map((row) => (
                          <option key={row.uuid} value={row.uuid}>
                            {row.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Observation date
                      <input
                        type="date"
                        value={form.value.date}
                        onChange={(event) => set<ObservationInput>({ date: event.target.value })}
                      />
                    </label>
                    <MoneyInput
                      label="Observed value (USD)"
                      value={form.value.amount}
                      onChange={(amount) => set<ObservationInput>({ amount })}
                    />
                  </>
                )}
                {draft.error && (
                  <p className="field-error" role="alert">
                    {draft.error}
                  </p>
                )}
                <div className="record-actions">
                  <button className="primary" type="button" onClick={save}>
                    Save {form.type === "entry" ? "contribution" : form.type}
                  </button>
                  {form.type === "entry" && form.record && (
                    <button
                      type="button"
                      className="danger"
                      onClick={() => {
                        const row = form.record as Contribution;
                        setConfirmation({
                          title: "Delete entry?",
                          message: "Use this for a mistaken record. Its history is retained.",
                          action: "Delete entry",
                          run: () =>
                            p.save(
                              destinations.remove(p.entity.id, kind, row.uuid, row.revision),
                              editor.saved,
                            ),
                        });
                      }}
                    >
                      Delete contribution
                    </button>
                  )}
                  {form.type === "observation" && form.record && (
                    <button
                      type="button"
                      className="danger"
                      onClick={() => {
                        const row = form.record as Observation;
                        setConfirmation({
                          title: "Delete observation?",
                          message: "Use this for a mistaken record. Its history is retained.",
                          action: "Delete observation",
                          run: () =>
                            p.save(
                              balances.remove(p.entity.id, "investment", row.uuid, row.revision),
                              editor.saved,
                            ),
                        });
                      }}
                    >
                      Delete observation
                    </button>
                  )}
                  {draft.changed && (
                    <button type="button" onClick={editor.discard}>
                      Discard changes
                    </button>
                  )}
                  <button type="button" onClick={() => editor.close(problem(form))}>
                    Close
                  </button>
                </div>
              </fieldset>
            </form>
          </aside>
        )}
      </div>
      <StatusBar mode={mode} help={showHelp} />
      <ConfirmDialog confirmation={confirmation} close={() => setConfirmation(null)} />
      <Shortcuts open={help} close={() => setHelp(false)} />
    </section>
  );
}

function DestinationFields({
  kind,
  record,
  value,
  set,
}: {
  kind: DestinationKind;
  record: Destination | null;
  value: DestinationForm;
  set: (patch: Partial<DestinationForm>) => void;
}) {
  const noun = kind === "investment" ? "investment" : "giving recipient";
  return (
    <>
      <legend>{record ? `Edit ${noun}` : `Add ${noun}`}</legend>
      <label>
        Name
        <input
          maxLength={120}
          value={value.name}
          aria-invalid={!value.name.trim()}
          onChange={(event) => set({ name: event.target.value })}
        />
      </label>
      <MoneyInput
        label="Cumulative contribution target (USD, optional)"
        value={value.target}
        required={false}
        onChange={(target) => set({ target })}
      />
      {!record && kind === "investment" && (
        <>
          <p className="muted">An opening observed value is optional and is not a contribution.</p>
          <label>
            Opening date
            <input
              type="date"
              value={value.openingDate}
              onChange={(event) => set({ openingDate: event.target.value })}
            />
          </label>
          <MoneyInput
            label="Opening observed value (USD, optional)"
            value={value.openingAmount}
            required={false}
            onChange={(openingAmount) => set({ openingAmount })}
          />
        </>
      )}
      {record?.opening && (
        <p className="muted">
          Opening observed value {dollars(record.opening.amount)} on {record.opening.date}; excluded
          from contribution progress.
        </p>
      )}
      {record && (
        <label className="check">
          <input
            type="checkbox"
            checked={value.active}
            onChange={(event) => set({ active: event.target.checked })}
          />
          Active for new contributions
        </label>
      )}
    </>
  );
}

function EntryFields({
  record,
  value,
  set,
  destinations: named,
  goals,
}: {
  record: Contribution | null;
  value: ContributionInput;
  set: (patch: Partial<ContributionInput>) => void;
  destinations: Destination[];
  goals: {
    account: { active: boolean; opening_date: string };
    goal: { uuid: string };
    label: string;
  }[];
}) {
  return (
    <>
      <legend>{record ? "Correct contribution" : "Record contribution"}</legend>
      <label>
        Financial date
        <input type="date" value={value.date} onChange={(e) => set({ date: e.target.value })} />
      </label>
      <label>
        Destination
        <select
          name="contribution-destination"
          value={value.destination_id ?? ""}
          onChange={(event) => set({ destination_id: event.target.value || null })}
        >
          <option value="">Unassigned</option>
          {named
            .filter((row) => row.active || row.uuid === record?.destination_id)
            .map((row) => (
              <option key={row.uuid} value={row.uuid}>
                {row.name}
                {row.active ? "" : " (inactive)"}
              </option>
            ))}
        </select>
      </label>
      <MoneyInput
        label="Amount (USD)"
        signed={value.is_adjustment}
        value={value.amount}
        onChange={(amount) => set({ amount })}
      />
      <label className="check">
        <input
          type="checkbox"
          checked={value.is_adjustment}
          onChange={(event) => set({ is_adjustment: event.target.checked })}
        />
        Adjustment to recorded total
      </label>
      <label>
        Funding origin
        <select
          value={value.funding_origin ?? "income"}
          onChange={(event) =>
            set({
              funding_origin: event.target.value as "income" | "savings",
              saving_goal_id: null,
            })
          }
        >
          <option value="income">Current income</option>
          <option value="savings">Previously saved money</option>
        </select>
      </label>
      {value.funding_origin === "savings" && (
        <label>
          Saving goal
          <select
            value={value.saving_goal_id ?? ""}
            onChange={(event) => set({ saving_goal_id: event.target.value || null })}
          >
            <option value="">Choose a goal</option>
            {goals
              .filter(({ account }) => account.active && account.opening_date <= value.date)
              .map(({ goal, label }) => (
                <option key={goal.uuid} value={goal.uuid}>
                  {label}
                </option>
              ))}
          </select>
        </label>
      )}
      <label>
        Note
        <textarea
          maxLength={2000}
          value={value.note}
          onChange={(event) => set({ note: event.target.value })}
        />
      </label>
    </>
  );
}
