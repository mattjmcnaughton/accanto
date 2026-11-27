import { type KeyboardEvent, useState } from "react";
import type { LoadState } from "../../lib/api";
import { type Observation, type ObservationInput, balances } from "../../lib/balances";
import {
  type Contribution,
  type ContributionFrequency,
  type ContributionInput,
  type Destination,
  type DestinationKind,
  type Liquidity,
  type TaxTreatment,
  assignmentField,
  assignmentOf,
  destinations,
} from "../../lib/destinations";
import { fmtDate, formatMoney, plural } from "../../lib/format";
import { savings } from "../../lib/savings";
import { Dialog, Empty, Field, Head, Icon, Trend, useRecordView, ViewToggle } from "../../ui";
import { type ScreenProps, useLoad } from "../workspace/shared";
import { InvestmentSummary } from "./InvestmentSummary";
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
  Progress,
  RecordGrid,
  Shortcuts,
  TrackedCard,
  dash,
  trendPoints,
  useRecordEditor,
  validMoney,
} from "./records";

type DestinationForm = {
  name: string;
  target: string;
  active: boolean;
  openingDate: string;
  openingAmount: string;
  /** Investments only: projection assumptions, blank when not set. */
  returnPercent: string;
  contribution: string;
  frequency: ContributionFrequency;
  /** Investments only: how the account is held. */
  taxTreatment: TaxTreatment;
  liquidity: Liquidity;
};
/** An annual percent, from −10 to 30, with up to two decimals. */
const RETURN_PERCENT = /^-?\d{1,2}(\.\d{1,2})?$/;
const validReturn = (value: string) =>
  RETURN_PERCENT.test(value.trim()) && Number(value) >= -10 && Number(value) <= 30;
const PER = { monthly: "a month", annual: "a year" } as const;
export const TAX: Record<TaxTreatment, string> = {
  taxable: "Taxable",
  tax_advantaged: "Tax-advantaged",
};
export const LIQUIDITY: Record<Liquidity, string> = { liquid: "Liquid", illiquid: "Illiquid" };
/** "6.00% a year, $500.00 a month", or null when neither assumption is set. */
export function expectationText(row: Destination): string | null {
  const parts = [
    row.expected_return_percent && `${row.expected_return_percent}% a year`,
    row.expected_contribution &&
      `${formatMoney(row.expected_contribution)} ${PER[row.expected_contribution_frequency ?? "monthly"]}`,
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}
/** The contribution being edited; `savings` keeps the origin choice while no goal is picked. */
type EntryForm = Omit<ContributionInput, "investment_id" | "giving_recipient_id"> & {
  destination: string | null;
  savings: boolean;
};
type Form =
  | {
      type: "destination";
      kind: DestinationKind;
      record: Destination | null;
      value: DestinationForm;
    }
  | { type: "entry"; kind: DestinationKind; record: Contribution | null; value: EntryForm }
  | { type: "observation"; record: Observation | null; value: ObservationInput };

const COPY = {
  investment: {
    title: "Investments",
    one: "investment",
    many: "investments",
    tip: "A value is a dated check-in you record from your statement; it is never calculated from contributions.",
    empty: "Track what you contribute and what it is worth.",
    registry: "Investments",
    entries: "Investment contributions",
    entryHeading: "Contributions",
    entryOne: "contribution",
    id: "investments-title",
    color: "invest",
  },
  giving: {
    title: "Giving",
    one: "recipient",
    many: "recipients",
    tip: "Progress counts recorded donations, net of refunds. It says nothing about tax treatment.",
    empty: "Add a person or organization you give to.",
    registry: "Giving recipients",
    entries: "Donations",
    entryHeading: "Donations",
    entryOne: "donation",
    id: "giving-title",
    color: "give",
  },
} as const;

function problem(form: Form): string {
  if (form.type === "destination") {
    const d = form.value;
    if (!d.name.trim()) return "Enter a name.";
    if (d.target && !validMoney(d.target))
      return "Enter the target as USD with up to two decimals.";
    if (d.openingAmount && (!validMoney(d.openingAmount) || !d.openingDate))
      return "Enter an opening date and a USD opening value with up to two decimals.";
    if (form.record?.opening && !d.openingDate) return "Enter an opening date.";
    if (d.returnPercent.trim() && !validReturn(d.returnPercent))
      return "Enter the expected return as a percent from −10 to 30 with up to two decimals.";
    if (d.contribution.trim() && !validMoney(d.contribution))
      return "Enter the expected contribution as USD with up to two decimals.";
    return "";
  }
  if (!form.value.date) return "Enter a date.";
  if (form.type === "entry") {
    const e = form.value;
    if (!validMoney(e.amount, e.is_adjustment))
      return e.is_adjustment
        ? "Enter a signed USD amount with up to two decimals."
        : "Enter a nonnegative USD amount with up to two decimals.";
    if (e.savings && !e.funding_goal_id) return "Choose a saving goal.";
    return "";
  }
  return validMoney(form.value.amount)
    ? ""
    : "Enter a nonnegative USD value with up to two decimals.";
}

const ready = <T,>(state: LoadState<T[]>): T[] => (state.kind === "ready" ? state.data : []);
const shown = (state: LoadState<unknown>) => state.kind === "ready" || state.kind === "empty";

/** One screen per kind: Investments or Giving, each at its own address. */
export function Destinations(p: ScreenProps & { kind?: DestinationKind }) {
  const screenKind = p.kind ?? "investment";
  const [view, setView] = useRecordView(screenKind);
  const [reload, setReload] = useState(0);
  const again = () => setReload((value) => value + 1);
  const deps = [p.entity.id, p.refresh, reload];
  const rows = {
    investment: useLoad(() => destinations.list(p.entity.id, "investment"), deps, {
      share: "investments",
    }),
    giving: useLoad(() => destinations.list(p.entity.id, "giving"), deps, { share: "giving" }),
  };
  const history = {
    investment: useLoad(() => destinations.history(p.entity.id, "investment"), deps, {
      share: "investment-history",
    }),
    giving: useLoad(() => destinations.history(p.entity.id, "giving"), deps, {
      share: "giving-history",
    }),
  };
  const observed = useLoad(() => balances.list(p.entity.id, "investment"), deps, {
    share: "investment-observations",
  });
  const accounts = useLoad(() => savings.list(p.entity.id), deps, { share: "savings" });
  const editor = useRecordEditor<Form>(p, again);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [help, setHelp] = useState(false);
  const [notice, setNotice] = useState("");
  const observations = ready(observed);
  const savingGoals =
    accounts.kind === "ready"
      ? accounts.data.flatMap((account) =>
          account.goals.map((goal) => ({ account, goal, label: `${account.name} · ${goal.name}` })),
        )
      : [];
  const nameOf = (kind: DestinationKind, id: string | null) =>
    ready(rows[kind]).find((item) => item.uuid === id)?.name ?? "Unassigned";
  const draft = editor.draft;
  const form = draft?.form;
  const set = <V,>(patch: Partial<V>) =>
    editor.update((current) => ({ ...current, value: { ...current.value, ...patch } }) as Form);
  const showHelp = () => setHelp(true);

  function editDestination(kind: DestinationKind, row: Destination | null) {
    editor.start(`destination:${kind}:${row?.uuid ?? "new"}`, {
      type: "destination",
      kind,
      record: row,
      value: row
        ? {
            name: row.name,
            target: row.target ?? "",
            active: row.active,
            openingDate: row.opening?.date ?? p.entity.today,
            openingAmount: row.opening?.amount ?? "",
            returnPercent: row.expected_return_percent ?? "",
            contribution: row.expected_contribution ?? "",
            frequency: row.expected_contribution_frequency ?? "monthly",
            taxTreatment: row.tax_treatment ?? "taxable",
            liquidity: row.liquidity ?? "liquid",
          }
        : {
            name: "",
            target: "",
            active: true,
            openingDate: p.entity.today,
            openingAmount: "",
            returnPercent: "",
            contribution: "",
            frequency: "monthly",
            taxTreatment: "taxable",
            liquidity: "liquid",
          },
    });
  }
  function editEntry(
    kind: DestinationKind,
    row: Contribution | null,
    destination: string | null = null,
  ) {
    if (row?.is_refund) {
      setNotice("Correct this linked refund in Activity.");
      return;
    }
    editor.start(`entry:${kind}:${row?.uuid ?? "new"}`, {
      type: "entry",
      kind,
      record: row,
      value: row
        ? {
            date: row.financial_date,
            amount: row.amount,
            destination: assignmentOf(kind, row),
            note: row.note,
            is_adjustment: row.is_adjustment,
            expected_revision: row.revision,
            savings: Boolean(row.funding_goal_id),
            funding_goal_id: row.funding_goal_id ?? null,
          }
        : {
            date: p.entity.today,
            amount: "",
            destination,
            note: "",
            is_adjustment: false,
            savings: false,
            funding_goal_id: null,
          },
    });
  }
  function editObservation(row: Observation | null, account: string | null = null) {
    if (row?.is_opening) {
      setNotice(
        "An opening value cannot be corrected; move its date from the investment's Edit dialog.",
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
        : { date: p.entity.today, amount: "", account_id: account },
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
  function removeEntry(kind: DestinationKind, row: Contribution) {
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
      const expectations =
        form.kind === "investment"
          ? {
              expected_return_percent: v.returnPercent.trim() || null,
              expected_contribution: v.contribution.trim() || null,
              expected_contribution_frequency: v.frequency,
              tax_treatment: v.taxTreatment,
              liquidity: v.liquidity,
            }
          : {};
      editor.submit(
        error,
        form.record
          ? destinations.edit(p.entity.id, form.kind, form.record.uuid, {
              name: v.name.trim(),
              target,
              active: v.active,
              expected_revision: form.record.revision,
              ...(form.record.opening && v.openingDate !== form.record.opening.date
                ? { opening_date: v.openingDate }
                : {}),
              ...expectations,
            })
          : destinations.create(p.entity.id, form.kind, {
              name: v.name.trim(),
              target,
              opening:
                form.kind === "investment" && v.openingAmount
                  ? { date: v.openingDate, amount: v.openingAmount.trim() }
                  : null,
              ...expectations,
            }),
      );
    } else if (form.type === "entry") {
      const { destination, savings, ...rest } = form.value;
      const v: ContributionInput = {
        ...rest,
        amount: rest.amount.trim(),
        [assignmentField(form.kind)]: destination,
        funding_goal_id: savings ? rest.funding_goal_id : null,
      };
      editor.submit(
        error,
        form.record
          ? destinations.correct(p.entity.id, form.kind, form.record.uuid, v)
          : destinations.record(p.entity.id, form.kind, v),
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

  const destinationColumns = (kind: DestinationKind): Column<Destination>[] => [
    { header: "Name", cell: (row) => <span className="rec-wrap">{row.name}</span> },
    { header: "Status", cell: (row) => (row.active ? "Active" : "Inactive") },
    {
      header: kind === "investment" ? "Contributions" : "Net donations",
      numeric: true,
      cell: (row) => formatMoney(row.contribution_progress),
    },
    {
      header: "Target",
      numeric: true,
      cell: (row) => (row.target ? formatMoney(row.target) : dash),
    },
    ...(kind === "investment"
      ? [
          {
            header: "Latest observed value",
            numeric: true,
            cell: (row: Destination) =>
              row.latest ? formatMoney(row.latest.amount) : <span className="muted">None</span>,
          },
          {
            header: "Observed on",
            cell: (row: Destination) => (row.latest ? <Day iso={row.latest.date} /> : dash),
          },
          {
            header: "Tax treatment",
            cell: (row: Destination) => TAX[row.tax_treatment ?? "taxable"],
          },
          {
            header: "Liquidity",
            cell: (row: Destination) => LIQUIDITY[row.liquidity ?? "liquid"],
          },
          {
            header: "Assumptions",
            wide: true,
            cell: (row: Destination) => (
              <span className="rec-wrap">{expectationText(row) ?? dash}</span>
            ),
          },
        ]
      : []),
    {
      header: "",
      cell: (row) => (
        <button
          type="button"
          className="btn sm quiet"
          tabIndex={-1}
          aria-label={`Edit ${row.name}`}
          onClick={() => editDestination(kind, row)}
        >
          Edit
        </button>
      ),
    },
  ];
  const entryColumns = (kind: DestinationKind): Column<Contribution>[] => [
    { header: "Date", cell: (row) => <Day iso={row.financial_date} /> },
    {
      header: kind === "investment" ? "Investment" : "Recipient",
      cell: (row) => nameOf(kind, assignmentOf(kind, row)),
    },
    {
      header: "Kind",
      wide: true,
      cell: (row) =>
        row.is_refund
          ? "Refund"
          : row.is_adjustment
            ? "Adjustment"
            : kind === "investment"
              ? "Contribution"
              : "Donation",
    },
    {
      header: "Funded from",
      wide: true,
      cell: (row) =>
        row.funding_origin === "savings"
          ? (savingGoals.find(({ goal }) => goal.uuid === row.funding_goal_id)?.label ??
            "Historical saving goal")
          : "Income",
    },
    { header: "Amount", numeric: true, cell: (row) => formatMoney(row.amount) },
    { header: "Note", wide: true, cell: (row) => <span className="note">{row.note}</span> },
    {
      header: "",
      cell: (row) =>
        row.is_refund ? (
          <span className="muted">Correct in Activity</span>
        ) : (
          <button
            type="button"
            className="btn sm quiet"
            tabIndex={-1}
            aria-label={`Correct entry on ${fmtDate(row.financial_date)}`}
            onClick={() => editEntry(kind, row)}
          >
            Correct
          </button>
        ),
    },
  ];
  const observationColumns: Column<Observation>[] = [
    { header: "Date", cell: (row) => <Day iso={row.financial_date} /> },
    { header: "Investment", cell: (row) => nameOf("investment", row.account_id) },
    { header: "Observed value", numeric: true, cell: (row) => formatMoney(row.amount) },
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
  const marked = draft?.changed ? draft.key.split(":").pop() : null;
  const markedIn = (type: Form["type"], kind?: DestinationKind) =>
    form?.type === type && (form.type === "observation" || form.kind === kind) ? marked : null;

  const cards = (kind: DestinationKind) =>
    ready(rows[kind]).map((row) => {
      const entries = ready(history[kind]).filter(
        (entry) => assignmentOf(kind, entry) === row.uuid,
      );
      const investment = kind === "investment";
      const name = row.name;
      return (
        <TrackedCard
          key={row.uuid}
          name={name}
          chips={[
            ...(row.active ? [] : ["Inactive"]),
            ...(investment
              ? [TAX[row.tax_treatment ?? "taxable"], LIQUIDITY[row.liquidity ?? "liquid"]]
              : []),
          ]}
          actions={
            <>
              {row.active && investment && (
                <button
                  type="button"
                  className="btn sm"
                  disabled={p.busy}
                  aria-label={`Record value for ${name}`}
                  onClick={() => editObservation(null, row.uuid)}
                >
                  Record value
                </button>
              )}
              {row.active && (
                <button
                  type="button"
                  className="btn sm"
                  disabled={p.busy}
                  aria-label={`Record ${COPY[kind].entryOne} for ${name}`}
                  onClick={() => editEntry(kind, null, row.uuid)}
                >
                  Record {COPY[kind].entryOne}
                </button>
              )}
              <button
                type="button"
                className="btn sm quiet"
                disabled={p.busy}
                aria-label={`Edit ${name} settings`}
                onClick={() => editDestination(kind, row)}
              >
                Edit
              </button>
            </>
          }
        >
          {investment && (
            <div>
              <div className="fig">
                {row.latest ? formatMoney(row.latest.amount) : "No value yet"}
              </div>
              <span className="cap">
                {row.latest
                  ? `Observed on ${fmtDate(row.latest.date)}`
                  : "Record a value from your statement to start a trend."}
              </span>
              <Trend
                points={trendPoints(observations, row.uuid)}
                kind={COPY[kind].color}
                label={`${name}, observed value`}
              />
            </div>
          )}
          {!investment && (
            <div>
              <div className="fig">{formatMoney(row.contribution_progress)}</div>
              <span className="cap">
                Net donations
                {entries.length > 0 && `, ${plural(entries.length, "entry", "entries")}`}
              </span>
            </div>
          )}
          {investment ? (
            <Progress
              done={row.contribution_progress}
              target={row.target}
              kind={COPY[kind].color}
              text={
                entries.length > 0
                  ? `${formatMoney(row.contribution_progress)} contributed in ${plural(entries.length, "entry", "entries")}`
                  : "No contributions recorded yet"
              }
            />
          ) : null}
          {investment ? (
            <p className="rec-expect">
              <span className="cap">Projection assumptions</span>
              {expectationText(row) ?? (
                <span className="muted">None yet. Use Edit to set an expected return.</span>
              )}
            </p>
          ) : (
            row.target && (
              <Progress
                done={row.contribution_progress}
                target={row.target}
                kind={COPY[kind].color}
                text={null}
              />
            )
          )}
        </TrackedCard>
      );
    });

  const addButton = (kind: DestinationKind) => (
    <button
      type="button"
      className="btn pri sm"
      disabled={p.busy}
      onClick={() => editDestination(kind, null)}
    >
      <Icon name="plus" />
      Add {COPY[kind].one}
    </button>
  );
  const section = (kind: DestinationKind) => {
    const copy = COPY[kind];
    const list = ready(rows[kind]);
    const add = addButton(kind);
    return (
      <>
        <LoadFailure state={rows[kind]} retry={again} />
        <LoadFailure state={history[kind]} retry={again} />
        {rows[kind].kind === "loading" && <Loading what={copy.many} />}
        {rows[kind].kind === "empty" && (
          <Empty title={`No ${copy.many} yet`} action={add}>
            {copy.empty}
          </Empty>
        )}
        {kind === "investment" && list.length > 0 && <InvestmentSummary rows={list} />}
        {view === "cards" && list.length > 0 && <div className="grid2">{cards(kind)}</div>}
        {view === "table" && (
          <div className="card pad rec-records">
            {shown(rows[kind]) && (
              <div className="rec-registry">
                <div className="rec-bar">
                  <h3 className="h2">All {copy.registry.toLowerCase()}</h3>
                </div>
                <RecordGrid
                  label={copy.registry}
                  rows={list}
                  rowId={(row) => row.uuid}
                  columns={destinationColumns(kind)}
                  empty={`No ${copy.one}s yet. Press a to add one.`}
                  marked={markedIn("destination", kind)}
                  edit={(row) => editDestination(kind, row)}
                  add={() => editDestination(kind, null)}
                  help={showHelp}
                />
              </div>
            )}
            <div>
              <div className="rec-bar">
                <h3 className="h2">{copy.entryHeading}</h3>
                <button
                  type="button"
                  className="btn sm"
                  disabled={p.busy}
                  onClick={() => editEntry(kind, null)}
                >
                  Record {copy.entryOne}
                </button>
              </div>
              {shown(history[kind]) ? (
                <RecordGrid
                  label={copy.entries}
                  rows={ready(history[kind])}
                  rowId={(row) => row.uuid}
                  columns={entryColumns(kind)}
                  empty={`No recorded ${copy.entryHeading.toLowerCase()} yet.`}
                  marked={markedIn("entry", kind)}
                  edit={(row) => editEntry(kind, row)}
                  add={() => editEntry(kind, null)}
                  remove={(row) => removeEntry(kind, row)}
                  help={showHelp}
                />
              ) : (
                history[kind].kind === "loading" && (
                  <Loading what={copy.entryHeading.toLowerCase()} />
                )
              )}
            </div>
            {kind === "investment" && (
              <div>
                <div className="rec-bar">
                  <h3 className="h2">Observed values</h3>
                  <button
                    type="button"
                    className="btn sm"
                    disabled={p.busy}
                    onClick={() => editObservation(null)}
                  >
                    Record value
                  </button>
                </div>
                <LoadFailure state={observed} retry={again} />
                {shown(observed) ? (
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
                ) : (
                  observed.kind === "loading" && <Loading what="observed values" />
                )}
              </div>
            )}
          </div>
        )}
      </>
    );
  };

  const keepOnEscape = (event: KeyboardEvent) => {
    if (form && event.key === "Escape" && !(event.target instanceof HTMLSelectElement)) {
      event.preventDefault();
      editor.close(problem(form));
    }
  };
  const titleOf = (value: Form) =>
    value.type === "destination"
      ? `${value.record ? "Edit" : "Add"} ${value.kind === "investment" ? "investment" : "giving recipient"}`
      : value.type === "entry"
        ? `${value.record ? "Correct" : "Record"} ${COPY[value.kind].entryOne}`
        : value.record
          ? "Correct observed value"
          : "Record observed value";

  return (
    <section
      aria-labelledby={COPY[screenKind].id}
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
        title={<span id={COPY[screenKind].id}>{COPY[screenKind].title}</span>}
        tip={COPY[screenKind].tip}
      >
        <ViewToggle view={view} choose={setView} />
        {ready(rows[screenKind]).length > 0 && addButton(screenKind)}
      </Head>
      <PendingEdit
        show={!!draft?.changed && !draft.open}
        busy={p.busy}
        review={() => draft && editor.start(draft.key, draft.form)}
        save={save}
        discard={editor.discard}
      />
      <Notice text={notice} dismiss={() => setNotice("")} />
      {section(screenKind)}
      {view === "table" && <KeyHint help={showHelp} />}
      {draft?.open && form && (
        <Dialog key={draft.key} title={titleOf(form)} onClose={() => editor.close(problem(form))}>
          <div ref={editor.aside} onKeyDown={keepOnEscape}>
            <form
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                editor.close(problem(form));
              }}
            >
              <fieldset disabled={p.busy} className="rec-fields">
                <div className="dlg-b">
                  {form.type === "destination" && (
                    <DestinationFields
                      kind={form.kind}
                      record={form.record}
                      value={form.value}
                      set={set<DestinationForm>}
                    />
                  )}
                  {form.type === "entry" && (
                    <EntryFields
                      kind={form.kind}
                      record={form.record}
                      value={form.value}
                      set={set<EntryForm>}
                      destinations={ready(rows[form.kind])}
                      goals={savingGoals}
                    />
                  )}
                  {form.type === "observation" && (
                    <>
                      <Field label="Investment">
                        <select
                          value={form.value.account_id ?? ""}
                          onChange={(event) =>
                            set<ObservationInput>({ account_id: event.target.value || null })
                          }
                        >
                          <option value="">Unassigned</option>
                          {ready(rows.investment).map((row) => (
                            <option key={row.uuid} value={row.uuid}>
                              {row.name}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Observation date">
                        <input
                          type="date"
                          value={form.value.date}
                          onChange={(event) => set<ObservationInput>({ date: event.target.value })}
                        />
                      </Field>
                      <MoneyField
                        label="Observed value (USD)"
                        value={form.value.amount}
                        onChange={(amount) => set<ObservationInput>({ amount })}
                      />
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
                  {form.type === "entry" && form.record && (
                    <button
                      type="button"
                      className="btn danger"
                      onClick={() => {
                        const row = form.record as Contribution;
                        const kind = form.kind;
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
                      Delete {COPY[form.kind].entryOne}
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
                              balances.remove(p.entity.id, "investment", row.uuid, row.revision),
                              editor.saved,
                            ),
                        });
                      }}
                    >
                      Delete observation
                    </button>
                  )}
                  <button type="button" className="btn pri" onClick={save}>
                    Save{" "}
                    {form.type === "entry"
                      ? COPY[form.kind].entryOne
                      : form.type === "destination"
                        ? COPY[form.kind].one
                        : "observation"}
                  </button>
                </div>
              </fieldset>
            </form>
          </div>
        </Dialog>
      )}
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
  return (
    <>
      <Field label="Name">
        <input
          maxLength={120}
          value={value.name}
          aria-invalid={!value.name.trim()}
          onChange={(event) => set({ name: event.target.value })}
        />
      </Field>
      <MoneyField
        label="Cumulative contribution target (USD, optional)"
        value={value.target}
        required={false}
        onChange={(target) => set({ target })}
      />
      {!record && kind === "investment" && (
        <>
          <p className="note">An opening observed value is optional and is not a contribution.</p>
          <div className="two">
            <Field label="Opening date">
              <input
                type="date"
                value={value.openingDate}
                onChange={(event) => set({ openingDate: event.target.value })}
              />
            </Field>
            <MoneyField
              label="Opening observed value (USD, optional)"
              value={value.openingAmount}
              required={false}
              onChange={(openingAmount) => set({ openingAmount })}
            />
          </div>
        </>
      )}
      {kind === "investment" && (
        <div className="two">
          <Segmented
            label="Tax treatment"
            hint="Tax-advantaged covers a 401(k), IRA or HSA"
            options={TAX}
            value={value.taxTreatment}
            set={(taxTreatment) => set({ taxTreatment })}
          />
          <Segmented
            label="Liquidity"
            hint="Liquid like a stock fund, illiquid like a house"
            options={LIQUIDITY}
            value={value.liquidity}
            set={(liquidity) => set({ liquidity })}
          />
        </div>
      )}
      {kind === "investment" && (
        <fieldset className="rec-assume">
          <legend>Projection assumptions</legend>
          <p className="note">Optional; used only by Projections.</p>
          <div className="two">
            <Field label="Expected return (% a year)" hint="Blank uses the default in Settings">
              <input
                inputMode="decimal"
                placeholder="6.00"
                value={value.returnPercent}
                aria-invalid={!!value.returnPercent.trim() && !validReturn(value.returnPercent)}
                onChange={(event) => set({ returnPercent: event.target.value })}
              />
            </Field>
            <div className="rec-contrib">
              <MoneyField
                label="Expected contribution (USD)"
                value={value.contribution}
                required={false}
                onChange={(contribution) => set({ contribution })}
              />
              {/* biome-ignore lint/a11y/useSemanticElements: The kit\'s segmented control is a button group. */}
              <div className="seg-control" role="group" aria-label="Contribution frequency">
                {(["monthly", "annual"] as const).map((frequency) => (
                  <button
                    key={frequency}
                    type="button"
                    aria-pressed={value.frequency === frequency}
                    onClick={() => set({ frequency })}
                  >
                    {frequency === "monthly" ? "Monthly" : "Annually"}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </fieldset>
      )}
      {record?.opening && (
        <>
          <Field label="Opening date">
            <input
              type="date"
              value={value.openingDate}
              aria-invalid={!value.openingDate}
              onChange={(event) => set({ openingDate: event.target.value })}
            />
          </Field>
          <p className="note">
            Opening value {formatMoney(record.opening.amount)}, not counted as a contribution.
          </p>
        </>
      )}
      {record && (
        <label className="rec-check">
          <input
            type="checkbox"
            checked={value.active}
            onChange={(event) => set({ active: event.target.checked })}
          />
          Active for new {kind === "investment" ? "contributions" : "donations"}
        </label>
      )}
    </>
  );
}

/** One choice from a small set, as the kit's segmented button group. */
function Segmented<V extends string>({
  label,
  hint,
  options,
  value,
  set,
}: {
  label: string;
  hint: string;
  options: Record<V, string>;
  value: V;
  set: (value: V) => void;
}) {
  return (
    <div className="field rec-traits">
      <span>{label}</span>
      {/* biome-ignore lint/a11y/useSemanticElements: The kit\'s segmented control is a button group. */}
      <div className="seg-control" role="group" aria-label={label}>
        {(Object.keys(options) as V[]).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={value === option}
            onClick={() => set(option)}
          >
            {options[option]}
          </button>
        ))}
      </div>
      <small>{hint}</small>
    </div>
  );
}

function EntryFields({
  kind,
  record,
  value,
  set,
  destinations: named,
  goals,
}: {
  kind: DestinationKind;
  record: Contribution | null;
  value: EntryForm;
  set: (patch: Partial<EntryForm>) => void;
  destinations: Destination[];
  goals: {
    account: { active: boolean; opening_date: string };
    goal: { uuid: string };
    label: string;
  }[];
}) {
  return (
    <>
      <Field label="Financial date">
        <input type="date" value={value.date} onChange={(e) => set({ date: e.target.value })} />
      </Field>
      <Field label="Destination">
        <select
          name={`${kind}-destination`}
          value={value.destination ?? ""}
          onChange={(event) => set({ destination: event.target.value || null })}
        >
          <option value="">Unassigned</option>
          {named
            .filter((row) => row.active || (record && row.uuid === assignmentOf(kind, record)))
            .map((row) => (
              <option key={row.uuid} value={row.uuid}>
                {row.name}
                {row.active ? "" : " (inactive)"}
              </option>
            ))}
        </select>
      </Field>
      <MoneyField
        label="Amount (USD)"
        signed={value.is_adjustment}
        value={value.amount}
        onChange={(amount) => set({ amount })}
      />
      <label className="rec-check">
        <input
          type="checkbox"
          checked={value.is_adjustment}
          onChange={(event) => set({ is_adjustment: event.target.checked })}
        />
        Adjustment to recorded total
      </label>
      <Field label="Funding origin">
        <select
          value={value.savings ? "savings" : "income"}
          onChange={(event) =>
            set({ savings: event.target.value === "savings", funding_goal_id: null })
          }
        >
          <option value="income">Current income</option>
          <option value="savings">Previously saved money</option>
        </select>
      </Field>
      {value.savings && (
        <Field label="Saving goal">
          <select
            value={value.funding_goal_id ?? ""}
            onChange={(event) => set({ funding_goal_id: event.target.value || null })}
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
        </Field>
      )}
      <Field label="Note">
        <textarea
          maxLength={2000}
          value={value.note}
          onChange={(event) => set({ note: event.target.value })}
        />
      </Field>
    </>
  );
}
