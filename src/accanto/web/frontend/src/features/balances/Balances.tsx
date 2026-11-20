import { type KeyboardEvent, useState } from "react";
import { type Loan, type Observation, type ObservationInput, balances } from "../../lib/balances";
import { fmtDate, formatMoney, plural } from "../../lib/format";
import { monthly } from "../../lib/monthly";
import { Dialog, Empty, Field, Head, Icon, Trend } from "../../ui";
import {
  type Column,
  ConfirmDialog,
  type Confirmation,
  Day,
  KeyHint,
  LoadFailure,
  Loading,
  MoneyField,
  Notice,
  PendingEdit,
  RecordGrid,
  Shortcuts,
  TrackedCard,
  dash,
  trendPoints,
  useRecordEditor,
  validMoney,
} from "../destinations/records";
import { type ScreenProps, useLoad } from "../workspace/shared";

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
  function editObservation(row: Observation | null, account?: string) {
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
            account_id: account ?? accounts.find((loan) => loan.active)?.uuid ?? null,
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
    { header: "Opening owed", numeric: true, cell: (loan) => formatMoney(loan.opening.amount) },
    { header: "Opened", cell: (loan) => <Day iso={loan.opening.date} /> },
    {
      header: "Latest observed owed",
      numeric: true,
      cell: (loan) => formatMoney(loan.latest.amount),
    },
    { header: "Observed on", cell: (loan) => <Day iso={loan.latest.financial_date} /> },
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
          className="btn sm quiet"
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
    { header: "Date", cell: (row) => <Day iso={row.financial_date} /> },
    { header: "Loan", cell: (row) => nameOf(row.account_id) },
    { header: "Amount owed", numeric: true, cell: (row) => formatMoney(row.amount) },
    { header: "Kind", wide: true, cell: (row) => (row.is_opening ? "Opening" : "Observation") },
    {
      header: "",
      cell: (row) =>
        row.is_opening ? null : (
          <button
            type="button"
            className="btn sm quiet"
            tabIndex={-1}
            aria-label={`Correct observation on ${fmtDate(row.financial_date)}`}
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
  const add = (
    <button type="button" className="btn pri" disabled={p.busy} onClick={() => openLoan(null)}>
      <Icon name="plus" />
      Add loan
    </button>
  );
  const keepOnEscape = (event: KeyboardEvent) => {
    if (form && event.key === "Escape" && !(event.target instanceof HTMLSelectElement)) {
      event.preventDefault();
      editor.close(problem(form));
    }
  };

  return (
    <section
      aria-labelledby="balances-title"
      className="screen records"
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
      <Head
        title={<span id="balances-title">Loans</span>}
        sub="The amount owed is a dated check-in you record from your lender. Recording a payment never changes it. Investment values are recorded in Investments and giving."
      >
        {accounts.length > 0 && add}
      </Head>
      <PendingEdit
        show={!!draft?.changed && !draft.open}
        busy={p.busy}
        review={() => draft && editor.start(draft.key, draft.form)}
        save={save}
        discard={editor.discard}
      />
      <Notice text={notice} dismiss={() => setNotice("")} />
      <LoadFailure state={loans} retry={again} />
      <LoadFailure state={payments} retry={again} />
      <LoadFailure state={observed} retry={again} />
      {loans.kind === "loading" && <Loading what="loans" />}
      {loans.kind === "empty" && (
        <Empty title="No loans yet" action={add}>
          Add a loan with what you owe today, then check in whenever your lender shows a new figure.
        </Empty>
      )}
      {accounts.length > 0 && (
        <div className="grid2">
          {accounts.map((account) => {
            const count = paymentsFor(account).length;
            return (
              <TrackedCard
                key={account.uuid}
                name={account.name}
                chip={account.active ? undefined : "Archived"}
                actions={
                  <>
                    {account.active && (
                      <button
                        type="button"
                        className="btn sm"
                        disabled={p.busy}
                        aria-label={`Record amount owed for ${account.name}`}
                        onClick={() => editObservation(null, account.uuid)}
                      >
                        Record amount owed
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn sm quiet"
                      disabled={p.busy}
                      aria-label={`${account.name} details`}
                      onClick={() => openLoan(account)}
                    >
                      Details
                    </button>
                  </>
                }
              >
                <div>
                  <div className="fig">{formatMoney(account.latest.amount)}</div>
                  <span className="cap">Owed on {fmtDate(account.latest.financial_date)}</span>
                  <Trend
                    points={trendPoints(observations, account.uuid)}
                    kind="fixed"
                    label={`${account.name}, amount owed`}
                  />
                </div>
                {payments.kind === "ready" || payments.kind === "empty" ? (
                  <span className="cap">
                    {count ? `${plural(count, "payment")} recorded.` : "No payments recorded."}{" "}
                    Payments do not change the amount owed.
                  </span>
                ) : null}
              </TrackedCard>
            );
          })}
        </div>
      )}
      <div className="card pad rec-records">
        {(loans.kind === "ready" || loans.kind === "empty") && (
          <div className="rec-registry">
            <div className="rec-bar">
              <h2 className="h2">All loans</h2>
            </div>
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
          </div>
        )}
        <div>
          <div className="rec-bar">
            <h2 className="h2">Amount owed observations</h2>
            <button
              type="button"
              className="btn sm"
              disabled={p.busy}
              onClick={() => editObservation(null)}
            >
              Record observation
            </button>
          </div>
          {observed.kind === "ready" || observed.kind === "empty" ? (
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
          ) : (
            observed.kind === "loading" && <Loading what="observations" />
          )}
        </div>
      </div>
      <KeyHint help={showHelp} />
      {draft?.open && form && (
        <Dialog
          key={draft.key}
          title={
            form.type === "loan"
              ? form.record
                ? form.record.name
                : "Add loan"
              : form.record
                ? "Correct amount owed"
                : "Record amount owed"
          }
          onClose={() => editor.close(problem(form))}
        >
          <div ref={editor.aside} onKeyDown={keepOnEscape}>
            {loan ? (
              <>
                <div className="dlg-b rec-details">
                  <dl>
                    <dt>Opened</dt>
                    <dd>
                      {fmtDate(loan.opening.date)} owing {formatMoney(loan.opening.amount)}
                    </dd>
                    <dt>Latest observed owed</dt>
                    <dd>
                      {formatMoney(loan.latest.amount)} on {fmtDate(loan.latest.financial_date)}
                    </dd>
                  </dl>
                  <h3>Payment history</h3>
                  {loanPayments.length === 0 ? (
                    <p className="note">No payments recorded for this loan.</p>
                  ) : (
                    <div className="rec-scroll">
                      <table className="rec-grid" aria-label={`Payments for ${loan.name}`}>
                        <thead>
                          <tr>
                            <th scope="col">Date</th>
                            <th scope="col">Fixed cost</th>
                            <th scope="col" className="num">
                              Payment
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {loanPayments.map((entry) => (
                            <tr key={entry.uuid}>
                              <td>
                                <Day iso={entry.financial_date} />
                              </td>
                              <td>{entry.fixed_cost_name ?? dash}</td>
                              <td className="num">{formatMoney(entry.amount)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <p className="note">Payments are recorded in Activity as fixed costs.</p>
                  {!loan.active && loan.draft_fixed_cost_lines.length > 0 && (
                    <p className="warn">
                      Review draft fixed-cost allocations for this archived loan.
                    </p>
                  )}
                  {loan.active && (
                    <p id="archive-rule" className="note">
                      Archive requires a latest observed amount owed of $0.00.
                    </p>
                  )}
                </div>
                <div className="dlg-f">
                  <button
                    type="button"
                    className="btn"
                    disabled={p.busy || (loan.active && loan.latest.amount !== "0.00")}
                    aria-describedby={loan.active ? "archive-rule" : undefined}
                    onClick={() => toggleArchive(loan)}
                  >
                    {loan.active ? "Archive loan" : "Reopen loan"}
                  </button>
                  <button type="button" className="btn pri" onClick={() => editor.close("")}>
                    Close
                  </button>
                </div>
              </>
            ) : (
              <form
                noValidate
                onSubmit={(event) => {
                  event.preventDefault();
                  editor.close(problem(form));
                }}
              >
                <fieldset disabled={p.busy} className="rec-fields">
                  <div className="dlg-b">
                    {form.type === "loan" ? (
                      <>
                        <Field label="Name">
                          <input
                            maxLength={120}
                            value={form.value.name}
                            onChange={(event) => set<LoanForm>({ name: event.target.value })}
                          />
                        </Field>
                        <div className="two">
                          <Field label="Opening date">
                            <input
                              type="date"
                              value={form.value.date}
                              onChange={(event) => set<LoanForm>({ date: event.target.value })}
                            />
                          </Field>
                          <MoneyField
                            label="Opening amount owed (USD)"
                            value={form.value.amount}
                            onChange={(amount) => set<LoanForm>({ amount })}
                          />
                        </div>
                      </>
                    ) : (
                      <>
                        <Field label="Loan">
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
                        </Field>
                        <div className="two">
                          <Field label="Observation date">
                            <input
                              type="date"
                              value={form.value.date}
                              onChange={(event) =>
                                set<ObservationInput>({ date: event.target.value })
                              }
                            />
                          </Field>
                          <MoneyField
                            label="Amount owed (USD)"
                            value={form.value.amount}
                            onChange={(amount) => set<ObservationInput>({ amount })}
                          />
                        </div>
                        <p className="note">
                          Copy the figure your lender shows. Payments you recorded are kept
                          separately.
                        </p>
                      </>
                    )}
                    {draft.error && (
                      <p className="err" role="alert">
                        {draft.error}
                      </p>
                    )}
                  </div>
                  <div className="dlg-f">
                    {draft.changed && (
                      <button type="button" className="btn quiet" onClick={editor.discard}>
                        Discard changes
                      </button>
                    )}
                    {form.type === "observation" && form.record && (
                      <button
                        type="button"
                        className="btn danger"
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
                    <button type="button" className="btn pri" onClick={save}>
                      {form.type === "loan" ? "Save loan" : "Save observation"}
                    </button>
                  </div>
                </fieldset>
              </form>
            )}
          </div>
        </Dialog>
      )}
      <ConfirmDialog confirmation={confirmation} close={() => setConfirmation(null)} />
      <Shortcuts open={help} close={() => setHelp(false)} />
    </section>
  );
}
