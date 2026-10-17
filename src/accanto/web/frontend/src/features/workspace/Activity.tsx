import { useMemo, useState } from "react";
import {
  type Kind,
  dateLabel,
  entryLabels,
  fundingLabel,
  kinds,
  money,
  references,
} from "./domain";
import { Empty, Icon, PageHead, type ViewProps } from "./ui";

export function Activity({ state, openEntry, month }: ViewProps & { month: string }) {
  const [search, setSearch] = useState("");
  const [period, setPeriod] = useState(month);
  const [kind, setKind] = useState("");
  const [source, setSource] = useState("");
  const entries = useMemo(
    () =>
      state.entries
        .filter((e) => !e.deleted)
        .filter(
          (e) =>
            (!period || e.date.startsWith(period)) &&
            (!kind || e.kind === kind) &&
            (!source || e.sourceId === source) &&
            `${e.note} ${e.label} ${e.tag} ${e.funding?.account ?? ""} ${entryLabels[e.kind]} ${e.amount / 100}`
              .toLowerCase()
              .includes(search.toLowerCase()),
        )
        .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id)),
    [state.entries, period, kind, source, search],
  );
  const income = entries.filter((e) => e.kind === "income").reduce((s, e) => s + e.amount, 0);
  const out = entries.filter((e) => e.kind !== "income").reduce((s, e) => s + e.amount, 0);
  const sources = kind ? references(state, kind as Kind) : [];
  return (
    <>
      <PageHead
        title="Activity"
        description="Every receipt, payment, and contribution."
        actions={
          <button className="button primary" type="button" onClick={() => openEntry()}>
            <Icon name="plus" size={17} />
            Add entry
          </button>
        }
      />
      <div className="ledger-toolbar">
        <label className="search-field">
          <Icon name="search" size={18} />
          <input
            aria-label="Search activity"
            placeholder="Search notes, categories, amounts…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button type="button" aria-label="Clear search" onClick={() => setSearch("")}>
              <Icon name="close" size={16} />
            </button>
          )}
        </label>
        <select
          aria-label="Filter activity by type"
          value={kind}
          onChange={(e) => {
            setKind(e.target.value);
            setSource("");
          }}
        >
          <option value="">All types</option>
          {kinds.map((k) => (
            <option key={k} value={k}>
              {entryLabels[k]}
            </option>
          ))}
        </select>
        <input
          type="month"
          aria-label="Filter activity by month"
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
        />
        <button
          type="button"
          className={`button ${!period ? "selected" : "quiet"}`}
          onClick={() => setPeriod("")}
        >
          All dates
        </button>
      </div>
      {sources.length > 0 && (
        <div className="filter-row">
          <select
            aria-label="Filter by source or goal"
            value={source}
            onChange={(e) => setSource(e.target.value)}
          >
            <option value="">
              All {kind === "income" ? "sources" : kind === "saving" ? "goals" : "categories"}
            </option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {!state.entries.length ? (
        <Empty
          icon="activity"
          title="Start with one entry"
          action={
            <button type="button" className="button primary" onClick={() => openEntry()}>
              Add your first entry
            </button>
          }
        >
          Record money received, spent, saved, or invested. Your monthly Review adds it up.
        </Empty>
      ) : (
        <section className="surface ledger">
          <div className="ledger-caption">
            <span>
              {entries.length} {entries.length === 1 ? "entry" : "entries"}
            </span>
            <span>
              In <strong>{money(income)}</strong>
              <span className="caption-divider" />
              Out <strong>{money(out)}</strong>
            </span>
          </div>
          <table className="activity-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Entry</th>
                <th>Type</th>
                <th className="numeric">Amount</th>
                <th>
                  <span className="sr-only">Edit</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td className="date-cell">
                    {dateLabel(e.date)}
                    <small>{e.date.slice(0, 4)}</small>
                  </td>
                  <td>
                    <button type="button" className="row-link" onClick={() => openEntry(e)}>
                      {e.adjustment && <small>Adjustment</small>}
                      {e.note || e.label}
                    </button>
                    <small>
                      {e.note ? e.label : e.tag || ""}
                      {e.note && e.tag ? ` · ${e.tag}` : ""}
                    </small>
                    {e.kind !== "income" && <small>From {fundingLabel(state, e)}</small>}
                  </td>
                  <td>
                    <span className={`type-tag ${e.kind}`}>{entryLabels[e.kind]}</span>
                  </td>
                  <td className={`numeric amount ${e.kind === "income" ? "positive" : ""}`}>
                    {e.kind === "income" ? "+" : ""}
                    {money(e.amount, true)}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Edit ${e.adjustment && <small>Adjustment</small>}{e.note || e.label}, ${e.date}`}
                      onClick={() => openEntry(e)}
                    >
                      <Icon name="edit" size={17} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!entries.length && (
            <div className="small-empty">
              No entries match these filters.
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  setSearch("");
                  setKind("");
                  setSource("");
                  setPeriod("");
                }}
              >
                Clear filters
              </button>
            </div>
          )}
        </section>
      )}
      {state.entries.length > 0 && (
        <p className="footnote">
          Out includes payments and contributions. These totals include all filtered entries and
          adjustments.
        </p>
      )}
    </>
  );
}
