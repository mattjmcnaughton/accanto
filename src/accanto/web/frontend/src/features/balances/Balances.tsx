import { type CSSProperties, type KeyboardEvent, useState } from "react";
import {
  type Loan,
  type LoanTerms,
  type Observation,
  type ObservationInput,
  type PayoffRow,
  type PayoffSchedule,
  type PayoffSummary,
  balances,
} from "../../lib/balances";
import {
  decimalToCents,
  fmtDate,
  fmtMon,
  fmtMonth,
  formatMoney,
  money,
  pct,
  plural,
} from "../../lib/format";
import { monthly } from "../../lib/monthly";
import {
  Band,
  Chart,
  Dialog,
  Empty,
  Field,
  Head,
  Icon,
  Trend,
  useRecordView,
  ViewToggle,
} from "../../ui";
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

type LoanForm = { name: string; date: string; amount: string; rate: string; payment: string };

/** A fixed annual percent, from 0 to 40, with up to two decimals. */
const RATE = /^\d{1,2}(\.\d{1,2})?$/;

/** Why the terms cannot be saved, or "". Both are optional. */
function termsProblem(rate: string, payment: string): string {
  if (rate.trim() && !(RATE.test(rate.trim()) && Number(rate) <= 40))
    return "Enter the interest rate as a percent from 0 to 40 with up to two decimals.";
  if (payment.trim() && !(validMoney(payment) && Number(payment) > 0))
    return "Enter the monthly payment as a USD amount above zero with up to two decimals.";
  return "";
}
const terms = (rate: string, payment: string): LoanTerms => ({
  interest_rate_percent: rate.trim() || null,
  monthly_payment: payment.trim() || null,
});

/** One line on a loan's payoff, from its latest recorded amount owed. */
export function payoffLine(payoff: PayoffSummary): string {
  switch (payoff.status) {
    case "scheduled":
      return `Paid off ${fmtMonth(payoff.payoff_date as string)}, ${formatMoney(payoff.total_interest)} interest left`;
    case "interest_not_covered":
      return `The ${formatMoney(payoff.monthly_payment)} payment does not cover ${formatMoney(payoff.monthly_interest)} monthly interest, so this debt never pays down.`;
    case "beyond_limit":
      return "Not repaid within 100 years at this payment.";
    case "paid_off":
      return "Paid off.";
    default:
      return "Add a rate and payment for a payoff date.";
  }
}
const termsLine = (loan: LoanTerms) =>
  loan.interest_rate_percent && loan.monthly_payment
    ? `${loan.interest_rate_percent}% fixed, ${formatMoney(loan.monthly_payment)} a month`
    : null;
type Form =
  | { type: "loan"; record: Loan | null; value: LoanForm }
  | { type: "observation"; record: Observation | null; value: ObservationInput };

function problem(form: Form): string {
  if (form.type === "loan") {
    if (form.record) return "";
    if (!form.value.name.trim()) return "Enter a name.";
    const terms = termsProblem(form.value.rate, form.value.payment);
    if (terms) return terms;
  } else if (!form.value.account_id) return "Choose a debt.";
  if (!form.value.date) return "Enter a date.";
  return validMoney(form.value.amount)
    ? ""
    : "Enter a nonnegative USD amount owed with up to two decimals.";
}

export function Balances(p: ScreenProps) {
  const [view, setView] = useRecordView("loans");
  const [reload, setReload] = useState(0);
  const again = () => setReload((value) => value + 1);
  const deps = [p.entity.id, p.refresh, reload];
  const loans = useLoad(() => balances.loans(p.entity.id), deps, { share: "loans" });
  const payments = useLoad(() => monthly.activity(p.entity.id), deps, { share: "activity" });
  const observed = useLoad(() => balances.list(p.entity.id, "debt"), deps, {
    share: "debt-observations",
  });
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
      value: { name: "", date: p.entity.today, amount: "", rate: "", payment: "" },
    });
  function editObservation(row: Observation | null, account?: string) {
    if (row?.is_opening) {
      setNotice(
        "An opening amount owed cannot be corrected; move its date from the debt's Details.",
      );
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
      action: "Archive debt",
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
          ...terms(form.value.rate, form.value.payment),
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
      header: "Rate",
      numeric: true,
      cell: (loan) => (loan.interest_rate_percent ? `${loan.interest_rate_percent}%` : dash),
    },
    {
      header: "Monthly payment",
      numeric: true,
      cell: (loan) => (loan.monthly_payment ? formatMoney(loan.monthly_payment) : dash),
    },
    {
      header: "Payoff",
      cell: (loan) =>
        loan.payoff.status === "scheduled" ? (
          <Day iso={loan.payoff.payoff_date as string} />
        ) : loan.payoff.status === "interest_not_covered" ? (
          <span className="chip warn">Payment under interest</span>
        ) : (
          dash
        ),
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
    { header: "Debt", cell: (row) => nameOf(row.account_id) },
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
      Add debt
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
        title={<span id="balances-title">Debts</span>}
        tip="The amount owed is a dated check-in you record from your lender. Recording a payment never changes it."
      >
        <ViewToggle view={view} choose={setView} />
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
      {loans.kind === "loading" && <Loading what="debts" />}
      {loans.kind === "empty" && (
        <Empty title="No debts yet" action={add}>
          Add a debt with what you owe today.
        </Empty>
      )}
      {view === "cards" && accounts.length > 0 && (
        <div className="grid2">
          {accounts.map((account) => {
            const count = paymentsFor(account).length;
            return (
              <TrackedCard
                key={account.uuid}
                name={account.name}
                chips={account.active ? [] : ["Archived"]}
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
                <div className="loan-payoff">
                  {termsLine(account) && <span className="cap">{termsLine(account)}</span>}
                  <p
                    className={account.payoff.status === "interest_not_covered" ? "warn" : "cap"}
                    role={account.payoff.status === "interest_not_covered" ? "note" : undefined}
                  >
                    {payoffLine(account.payoff)}
                  </p>
                </div>
                {payments.kind === "ready" || payments.kind === "empty" ? (
                  <span className="cap">
                    {count ? `${plural(count, "payment")} recorded` : "No payments recorded"}
                  </span>
                ) : null}
              </TrackedCard>
            );
          })}
        </div>
      )}
      {view === "table" && (
        <div className="card pad rec-records">
          {(loans.kind === "ready" || loans.kind === "empty") && (
            <div className="rec-registry">
              <div className="rec-bar">
                <h2 className="h2">All debts</h2>
              </div>
              <RecordGrid
                label="Debts"
                rows={accounts}
                rowId={(row) => row.uuid}
                columns={loanColumns}
                empty="No debts yet. Press a to add one."
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
      )}
      {view === "table" && <KeyHint help={showHelp} />}
      {draft?.open && form && (
        <Dialog
          key={draft.key}
          title={
            form.type === "loan"
              ? form.record
                ? form.record.name
                : "Add debt"
              : form.record
                ? "Correct amount owed"
                : "Record amount owed"
          }
          onClose={() => editor.close(problem(form))}
          className={loan ? "loan-dlg" : undefined}
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
                  <LoanTermsForm
                    key={`${loan.uuid}:${loan.revision}`}
                    loan={loan}
                    busy={p.busy}
                    save={(value) =>
                      p.save(
                        balances.editLoan(p.entity.id, loan.uuid, {
                          name: loan.name,
                          active: loan.active,
                          expected_revision: loan.revision,
                          ...value,
                        }),
                        editor.saved,
                      )
                    }
                  />
                  <PayoffDetails entity={p.entity.id} loan={loan} refresh={p.refresh} />
                  <h3>Payment history</h3>
                  {loanPayments.length === 0 ? (
                    <p className="note">No payments recorded for this debt.</p>
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
                  <p className="note">Record payments in Activity.</p>
                  {!loan.active && loan.draft_fixed_cost_lines.length > 0 && (
                    <p className="warn">
                      Review draft fixed-cost allocations for this archived debt.
                    </p>
                  )}
                  {loan.active && (
                    <p id="archive-rule" className="note">
                      Archiving needs $0.00 owed.
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
                    {loan.active ? "Archive debt" : "Reopen debt"}
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
                        <div className="two">
                          <Field label="Fixed interest rate (% a year, optional)">
                            <input
                              inputMode="decimal"
                              placeholder="0.00"
                              value={form.value.rate}
                              onChange={(event) => set<LoanForm>({ rate: event.target.value })}
                            />
                          </Field>
                          <MoneyField
                            label="Monthly payment (USD, optional)"
                            value={form.value.payment}
                            required={false}
                            onChange={(payment) => set<LoanForm>({ payment })}
                          />
                        </div>
                        <p className="note">Fixed rates only.</p>
                      </>
                    ) : (
                      <>
                        <Field label="Debt">
                          <select
                            value={form.value.account_id ?? ""}
                            onChange={(event) =>
                              set<ObservationInput>({ account_id: event.target.value || null })
                            }
                          >
                            <option value="">Choose debt</option>
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
                        <p className="note">Copy the figure your lender shows.</p>
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
                      {form.type === "loan" ? "Save debt" : "Save observation"}
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

function LoanTermsForm({
  loan,
  busy,
  save,
}: {
  loan: Loan;
  busy: boolean;
  save: (value: LoanTerms & { opening_date?: string }) => void;
}) {
  const [opened, setOpened] = useState(loan.opening.date);
  const [rate, setRate] = useState(loan.interest_rate_percent ?? "");
  const [payment, setPayment] = useState(loan.monthly_payment ?? "");
  const [error, setError] = useState("");
  const changed =
    opened !== loan.opening.date ||
    rate.trim() !== (loan.interest_rate_percent ?? "") ||
    payment.trim() !== (loan.monthly_payment ?? "");
  return (
    <form
      className="loan-terms"
      aria-label={`Terms for ${loan.name}`}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const problem = opened ? termsProblem(rate, payment) : "Enter an opening date.";
        setError(problem);
        if (!problem)
          save({
            ...terms(rate, payment),
            ...(opened !== loan.opening.date ? { opening_date: opened } : {}),
          });
      }}
    >
      <h3>Loan terms</h3>
      <Field label="Opening date">
        <input type="date" value={opened} onChange={(event) => setOpened(event.target.value)} />
      </Field>
      <p className="note">When the debt began; no later than its next record.</p>
      <div className="two">
        <Field label="Fixed interest rate (% a year)">
          <input
            inputMode="decimal"
            placeholder="0.00"
            value={rate}
            onChange={(event) => setRate(event.target.value)}
          />
        </Field>
        <MoneyField
          label="Monthly payment (USD)"
          value={payment}
          required={false}
          onChange={setPayment}
        />
      </div>
      {error && (
        <p className="err" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        <button type="submit" className="btn sm" disabled={busy || !changed}>
          Save debt
        </button>
      </div>
    </form>
  );
}

/** The month-by-month schedule from the latest recorded amount owed. */
function PayoffDetails({ entity, loan, refresh }: { entity: string; loan: Loan; refresh: number }) {
  const state = useLoad(
    () => balances.schedule(entity, loan.uuid),
    [entity, loan.uuid, loan.revision, loan.latest.uuid, loan.latest.revision, refresh],
  );
  const schedule = state.kind === "ready" ? state.data : null;
  const payoff = schedule ?? loan.payoff;
  return (
    <section className="loan-schedule" aria-label={`Payoff schedule for ${loan.name}`}>
      <h3>Payoff schedule</h3>
      <p className="note">
        From {formatMoney(payoff.balance)} owed on {fmtDate(payoff.as_of)}.
      </p>
      {payoff.status === "scheduled" ? (
        <dl>
          <dt>Payoff date</dt>
          <dd>
            {fmtDate(payoff.payoff_date as string)}, in {plural(payoff.months ?? 0, "payment")}
          </dd>
          <dt>Interest remaining</dt>
          <dd>{formatMoney(payoff.total_interest)}</dd>
          <dt>Total to pay</dt>
          <dd>{formatMoney(payoff.total_paid)}</dd>
          <dt>First month&apos;s interest</dt>
          <dd>{formatMoney(payoff.monthly_interest)}</dd>
        </dl>
      ) : (
        <p className={payoff.status === "interest_not_covered" ? "warn" : "note"} role="note">
          {payoffLine(payoff)}
        </p>
      )}
      <LoadFailure state={state} retry={() => undefined} />
      {schedule && schedule.rows.length > 0 && (
        <>
          <PayoffCharts schedule={schedule} name={loan.name} />
          <div className="rec-scroll loan-rows">
            <table className="rec-grid" aria-label={`Payoff schedule rows for ${loan.name}`}>
              <thead>
                <tr>
                  <th scope="col">Month</th>
                  <th scope="col" className="num">
                    Payment
                  </th>
                  <th scope="col" className="num">
                    Interest
                  </th>
                  <th scope="col" className="num">
                    Principal
                  </th>
                  <th scope="col" className="num">
                    Owed after
                  </th>
                </tr>
              </thead>
              <tbody>
                {schedule.rows.map((row) => (
                  <tr key={row.month}>
                    <td className="loan-month">
                      {fmtMon(row.date)} {row.date.slice(0, 4)}
                    </td>
                    <td className="num">{formatMoney(row.payment)}</td>
                    <td className="num">{formatMoney(row.interest)}</td>
                    <td className="num">{formatMoney(row.principal)}</td>
                    <td className="num">{formatMoney(row.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

const cents = (value: string) => decimalToCents(value) ?? 0;
type Owed = Pick<PayoffRow, "month" | "date" | "balance">;
type Year = { year: string; payments: number; interest: number; principal: number };

/** Amount owed after each payment, and each year's interest and principal. */
function PayoffCharts({ schedule, name }: { schedule: PayoffSchedule; name: string }) {
  const rows = schedule.rows;
  const owed: Owed[] = [{ month: 0, date: schedule.as_of, balance: schedule.balance }, ...rows];
  const last = owed.length - 1;
  const short = rows.length < 24;
  const every = rows.length <= 72 ? 1 : rows.length <= 144 ? 2 : rows.length <= 360 ? 5 : 10;
  const label = (r: Owed) =>
    short ? `${fmtMon(r.date)} ’${r.date.slice(2, 4)}` : r.date.slice(0, 4);
  const owedTick = (r: Owed, i: number) => {
    if (i === 0) return "Now";
    if (i === last) return label(r);
    const gap = short ? 6 : 12 * every;
    return r.month % gap === 0 && last - i >= gap * 0.6 ? label(r) : null;
  };

  const years: Year[] = [];
  for (const row of rows) {
    const year = row.date.slice(0, 4);
    let at = years[years.length - 1];
    if (at?.year !== year) {
      at = { year, payments: 0, interest: 0, principal: 0 };
      years.push(at);
    }
    at.payments += 1;
    at.interest += cents(row.interest);
    at.principal += cents(row.principal);
  }
  const interest = years.reduce((sum, y) => sum + y.interest, 0);
  const principal = years.reduce((sum, y) => sum + y.principal, 0);
  const total = interest + principal;
  const step = Math.ceil(years.length / 6);
  return (
    <>
      <Chart
        rows={owed}
        series={[
          { key: "owed", name: "Owed", color: "var(--c-fixed)", pick: (r) => cents(r.balance) },
        ]}
        title="Amount owed"
        label={`${name}, amount owed by month`}
        when={(r) => (r.month === 0 ? "Now" : `${fmtMon(r.date)} ${r.date.slice(0, 4)}`)}
        note={(r) => (r.month === 0 ? null : `Payment ${r.month} of ${rows.length}`)}
        tick={owedTick}
      />
      <div className="loan-split">
        <span className="chart-title">Interest vs principal</span>
        <Band
          label={`${name}: ${money(principal)} principal, ${money(interest)} interest`}
          parts={[
            {
              key: "principal",
              kind: "fixed",
              weight: principal,
              title: `Principal ${money(principal)}`,
            },
            {
              key: "interest",
              kind: "free",
              weight: interest,
              title: `Interest ${money(interest)}`,
            },
          ]}
        />
        <div className="chart-legend">
          <span className="chart-key bar" style={{ "--c": "var(--c-fixed)" } as CSSProperties}>
            Principal <strong>{money(principal)}</strong> · {pct(principal, total, 0)}
          </span>
          <span className="chart-key bar" style={{ "--c": "var(--c-free)" } as CSSProperties}>
            Interest <strong>{money(interest)}</strong> · {pct(interest, total, 0)}
          </span>
        </div>
      </div>
      <Chart
        bars
        rows={years}
        series={[
          {
            key: "principal",
            name: "Principal",
            color: "var(--c-fixed)",
            pick: (y) => y.principal,
          },
          { key: "interest", name: "Interest", color: "var(--c-free)", pick: (y) => y.interest },
        ]}
        title="Paid per year"
        label={`${name}, interest and principal by year`}
        when={(y) => (y.payments < 12 ? `${y.year}, ${plural(y.payments, "payment")}` : y.year)}
        note={(y) => `Interest ${pct(y.interest, y.interest + y.principal, 0)}`}
        tick={(y, i) => (i % step === 0 ? y.year : null)}
      />
    </>
  );
}
