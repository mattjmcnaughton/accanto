import type { IsoDate, LoadState, UUID } from "../../lib/api";
import { plural } from "../../lib/format";
import { type Routine, dayLabel } from "../../lib/routines";
import { currentLine } from "./Routines";
import "./routines.css";

/**
 * Home's Routines section: one line per due or overdue routine, then the next date of the rest.
 * With nothing due it is one muted line. It reads only routines, never financial records.
 */
export function RoutinesCard({
  state,
  today,
  open,
  all,
}: {
  state: LoadState<Routine[]>;
  today: IsoDate;
  /** Opens a routine's occurrence. */
  open: (routine: UUID, on: IsoDate) => void;
  /** Opens the Routines screen. */
  all: () => void;
}) {
  if (state.kind !== "ready") return null;
  const active = state.data.filter((r) => r.active);
  if (!active.length) return null;
  const outstanding = (r: Routine) => r.current?.state === "due" || r.current?.state === "overdue";
  const needs = active.filter(outstanding);
  const rest = active
    .filter((r) => !outstanding(r) && r.next_on)
    .sort((a, b) => (a.next_on ?? "").localeCompare(b.next_on ?? ""));
  const nextUp = rest[0];

  return (
    <section aria-labelledby="home-routines" className="rt-home">
      <h2 className="h2" id="home-routines">
        Routines{" "}
        <span>{needs.length ? `${plural(needs.length, "routine")} to finish` : "Nothing due"}</span>
        <button type="button" className="btn sm quiet" onClick={all}>
          All routines
        </button>
      </h2>
      <ul className="card home-list" aria-label="Routines">
        {needs.map((r) => {
          const line = currentLine(r, today);
          const on = r.current?.scheduled_on ?? "";
          return (
            <li key={r.uuid}>
              <button type="button" className="row" onClick={() => open(r.uuid, on)} data-row>
                <span className="pip" />
                <span className="t">
                  {r.name}
                  <small className="warn">{line.text}</small>
                </span>
                <span className="go">Continue</span>
              </button>
            </li>
          );
        })}
        {needs.length > 0
          ? rest.map((r) => (
              <li key={r.uuid}>
                <div className="row">
                  <span className={`pip ${r.current?.state === "done" ? "good" : "quiet"}`} />
                  <span className="t">
                    {r.name}
                    <small>{currentLine(r, today).text}</small>
                  </span>
                </div>
              </li>
            ))
          : nextUp?.next_on && (
              <li>
                <div className="row">
                  <span className="pip quiet" />
                  <span className="t">
                    <small>
                      All caught up. Next: {nextUp.name}, {dayLabel(nextUp.next_on, today)}.
                    </small>
                  </span>
                </div>
              </li>
            )}
      </ul>
    </section>
  );
}
