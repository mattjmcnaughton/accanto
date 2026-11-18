import { useState } from "react";
import { type Loan, type Observation, type ObservationInput, balances } from "../../lib/balances";
import { monthly } from "../../lib/monthly";
import {
  type Column,
  type Confirmation,
  ConfirmDialog,
  RecordGrid,
  Shortcuts,
  StatusBar,
  dash,
  modeFor,
  useRecordEditor,
  validMoney,
} from "../destinations/records";
import { LoadMessage, MoneyInput, type ScreenProps, dollars, useLoad } from "../workspace/shared";

type LoanForm = { name: string; date: string; amount: string };
type Form =
  | { type: "loan"; record: Loan | null; value: LoanForm }
  | { type: "observation"; record: Observation | null; value: ObservationInput };

function problem(form: Form): string {
  if (form.type === "loan") {
    if (form.record) return "";
    if (!form.value.name.trim()) return "Enter a name.";
  } else if (!form.value.account_id) return "Choose a loan.";
  if (!form.value.date) return "Enter a date.";
  return validMoney(form.value.amount)
    ? ""
    : "Enter a nonnegative USD amount owed with up to two decimals.";
}

export function Balances(p: ScreenProps) {
  const [reload, setReload] = useState(0);
  const again = () => setReload((value) => value + 1);
  const loans = useLoad(() => balances.loans(p.entity.id), [p.entity.id, p.refresh, reload]);
  const payments = useLoad(() => monthly.activity(p.entity.id), [p.entity.id, p.refresh, reload]);
  const observed = useLoad(
    () => balances.list(p.entity.id, "debt"),
    [p.entity.id, p.refresh, reload],
  );
  const editor = useRecordEditor<Form>(p, again);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [help, setHelp] = useState(false);
  const [notice, setNotice] = useState("");
  const [mode, setMode] = useState("READY");
  const accounts = loans.kind === "ready" ? loans.data : [];
  const observations = observed.kind === "ready" ? observed.data : [];
  const paymentsFor = (loan: Loan) =>
    payments.kind === "ready"
      ? payments.data.filter(
          (entry) => entry.category === "fixed_cost" && entry.debt_account_id === loan.uuid,
        )
      : [];
  const nameOf = (id: string | null) =>
    accounts.find((account) => account.uuid === id)?.name ?? "Unassigned";
  const draft = editor.draft;
  const form = draft?.form;
  const set = <V,>(patch: Partial<V>) =>
    editor.update((current) => ({ ...current, value: { ...current.value, ...patch } }) as Form);
  const showHelp = () => setHelp(true);

  const openLoan = (loan: Loan | null) =>
    editor.start(`loan:${loan?.uuid ?? "new"}`, {
      type: "loan",
      record: loan,
      value: { name: "", date: p.entity.today, amount: "" },
    });
  function editObservation(row: Observation | null) {
    if (row?.is_opening) {
      setNotice("An opening amount owed is set when the loan is added and cannot be corrected.");
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
        : {
            date: p.entity.today,
            amount: "",
            account_id: accounts.find((loan) => loan.active)?.uuid ?? null,
          },
    });
  }
  function removeObservation(row: Observation) {
    if (row.is_opening) {
      setNotice("Opening amounts owed cannot be deleted.");
      return;
    }
    if (draft?.changed) {
      setNotice("Save or discard the unsaved edit before deleting another record.");
      return;
    }
    setConfirmation({
      title: "Delete observation?",
      message: "Use this for a mistaken record. Its history is retained.",
      action: "Delete observation",
      run: () => p.save(balances.remove(p.entity.id, "debt", row.uuid, row.revision), editor.saved),
    });
  }
  function toggleArchive(loan: Loan) {
    const spec = balances.editLoan(p.entity.id, loan.uuid, {
      name: loan.name,
      active: !loan.active,
      expected_revision: loan.revision,
    });
    if (!loan.active) {
      p.save(spec, editor.saved);
      return;
    }
    setConfirmation({
      title: `Archive ${loan.name}?`,
      message: "Its payments and observations are kept. You can reopen it later.",
      action: "Archive loan",
      run: () => p.save(spec, editor.saved),
    });
  }
  function save() {
    if (!form) return;
    const error = problem(form);
    if (form.type === "loan") {
      if (form.record) return;
      editor.submit(
        error,
        balances.createLoan(p.entity.id, {
          name: form.value.name.trim(),
          opening: { date: form.value.date, amount: form.value.amount.trim() },
        }),
      );
    } else {
      const v = { ...form.value, amount: form.value.amount.trim() };
      editor.submit(
        error,
        form.record
          ? balances.correct(p.entity.id, "debt", form.record.uuid, v)
          : balances.create(p.entity.id, "debt", v),
      );
    }
  }

  const loanColumns: Column<Loan>[] = [
    { header: "Name", cell: (loan) => loan.name },
    { header: "Status", cell: (loan) => (loan.active ? "Active" : "Archived") },
    { header: "Opening owed", numeric: true, cell: (loan) => dollars(loan.opening.amount) },
    { header: "Opened", cell: (loan) => <time>{loan.opening.date}</time> },
    { header: "Latest observed owed", numeric: true, cell: (loan) => dollars(loan.latest.amount) },
    { header: "Observed on", cell: (loan) => <time>{loan.latest.financial_date}</time> },
    {
      header: "Payments",
      numeric: true,
      cell: (loan) =>
        payments.kind === "ready" || payments.kind === "empty" ? paymentsFor(loan).length : dash,
    },
    {
      header: "",
      cell: (loan) => (
        <button
          type="button"
          tabIndex={-1}
          aria-label={`Details for ${loan.name}`}
          onClick={() => openLoan(loan)}
        >
          Details
        </button>
      ),
    },
  ];
  const observationColumns: Column<Observation>[] = [
    { header: "Date", cell: (row) => <time>{row.financial_date}</time> },
    { header: "Loan", cell: (row) => nameOf(row.account_id) },
    { header: "Amount owed", numeric: true, cell: (row) => dollars(row.amount) },
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
  const marked = draft?.changed && form?.type === "observation" ? draft.key.split(":")[1] : null;
  const loan = form?.type === "loan" ? form.record : null;
  const loanPayments = loan ? paymentsFor(loan) : [];

  return (
    <section
      aria-labelledby="balances-title"
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
        <h2 id="balances-title">Loans and observed balances</h2>
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
        Payments do not calculate amounts owed; each amount owed is a dated observation. Investment
        values are recorded in Investments and giving.
      </p>
      {notice && (
        <output className="notice">
          {notice}
          <button type="button" aria-label="Dismiss message" onClick={() => setNotice("")}>
            ×
          </button>
        </output>
      )}
      <LoadMessage state={loans} retry={again} />
      <LoadMessage state={payments} retry={again} />
      <LoadMessage state={observed} retry={again} />
      <div className={`data-layout${draft?.open ? " with-sidebar" : ""}`}>
        <div className="record-tables">
          <div className="table-heading">
            <h3>Loans</h3>
            <button type="button" disabled={p.busy} onClick={() => openLoan(null)}>
              Add loan
            </button>
          </div>
          {(loans.kind === "ready" || loans.kind === "empty") && (
            <RecordGrid
              label="Loans"
              rows={accounts}
              rowId={(row) => row.uuid}
              columns={loanColumns}
              empty="No loans yet. Press a to add one."
              edit={openLoan}
              add={() => openLoan(null)}
              help={showHelp}
            />
          )}
          <div className="table-heading">
            <h3>Amount owed observations</h3>
            <button type="button" disabled={p.busy} onClick={() => editObservation(null)}>
              Record observation
            </button>
          </div>
          {(observed.kind === "ready" || observed.kind === "empty") && (
            <RecordGrid
              label="Amount owed observations"
              rows={observations}
              rowId={(row) => row.uuid}
              columns={observationColumns}
              empty="No observations yet."
              marked={marked}
              edit={editObservation}
              add={() => editObservation(null)}
              remove={removeObservation}
              help={showHelp}
            />
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
            {loan ? (
              <div className="loan-details">
                <h3>{loan.name}</h3>
                <dl>
                  <dt>Opened</dt>
                  <dd>
                    {loan.opening.date} owing {dollars(loan.opening.amount)}
                  </dd>
                  <dt>Latest observed owed</dt>
                  <dd>
                    {dollars(loan.latest.amount)} on {loan.latest.financial_date}
                  </dd>
                </dl>
                <h4>Payment history</h4>
                {loanPayments.length === 0 ? (
                  <p className="muted">No payments recorded for this loan.</p>
                ) : (
                  <table className="data-grid" aria-label={`Payments for ${loan.name}`}>
                    <thead>
                      <tr>
                        <th scope="col">Date</th>
                        <th scope="col">Fixed cost</th>
                        <th scope="col" className="numeric">
                          Payment
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {loanPayments.map((entry) => (
                        <tr key={entry.uuid}>
                          <td>
                            <time>{entry.financial_date}</time>
                          </td>
                          <td>{entry.fixed_cost_name ?? dash}</td>
                          <td className="numeric">{dollars(entry.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <p className="muted">Payments are recorded in Activity as fixed costs.</p>
                {!loan.active && loan.draft_fixed_cost_lines.length > 0 && (
                  <p className="warning">
                    Review draft fixed-cost allocations for this archived loan.
                  </p>
                )}
                <div className="record-actions">
                  <button
                    type="button"
                    disabled={p.busy || (loan.active && loan.latest.amount !== "0.00")}
                    aria-describedby={loan.active ? "archive-rule" : undefined}
                    onClick={() => toggleArchive(loan)}
                  >
                    {loan.active ? "Archive loan" : "Reopen loan"}
                  </button>
                  <button type="button" onClick={() => editor.close("")}>
                    Close
                  </button>
                </div>
                {loan.active && (
                  <p id="archive-rule" className="muted">
                    Archive requires a latest observed amount owed of $0.00.
                  </p>
                )}
              </div>
            ) : (
              <form
                noValidate
                onSubmit={(event) => {
                  event.preventDefault();
                  editor.close(problem(form));
                }}
              >
                <fieldset disabled={p.busy}>
                  {form.type === "loan" ? (
                    <>
                      <legend>Add loan</legend>
                      <label>
                        Name
                        <input
                          maxLength={120}
                          value={form.value.name}
                          onChange={(event) => set<LoanForm>({ name: event.target.value })}
                        />
                      </label>
                      <label>
                        Opening date
                        <input
                          type="date"
                          value={form.value.date}
                          onChange={(event) => set<LoanForm>({ date: event.target.value })}
                        />
                      </label>
                      <MoneyInput
                        label="Opening amount owed (USD)"
                        value={form.value.amount}
                        onChange={(amount) => set<LoanForm>({ amount })}
                      />
                    </>
                  ) : (
                    <>
                      <legend>{form.record ? "Correct amount owed" : "Record amount owed"}</legend>
                      <label>
                        Loan
                        <select
                          value={form.value.account_id ?? ""}
                          onChange={(event) =>
                            set<ObservationInput>({ account_id: event.target.value || null })
                          }
                        >
                          <option value="">Choose loan</option>
                          {accounts.map((account) => (
                            <option key={account.uuid} value={account.uuid}>
                              {account.name}
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
                        label="Amount owed (USD)"
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
                      {form.type === "loan" ? "Save loan" : "Save observation"}
                    </button>
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
                                balances.remove(p.entity.id, "debt", row.uuid, row.revision),
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
            )}
          </aside>
        )}
      </div>
      <StatusBar mode={mode} help={showHelp} />
      <ConfirmDialog confirmation={confirmation} close={() => setConfirmation(null)} />
      <Shortcuts open={help} close={() => setHelp(false)} />
    </section>
  );
}
