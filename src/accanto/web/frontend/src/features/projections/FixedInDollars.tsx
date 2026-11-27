import { useEffect, useId, useRef, useState } from "react";
import { decimalToCents, formatMoney, money } from "../../lib/format";
import type { PlannedFixedCosts } from "../../lib/projections";

/**
 * A multi-select of the planned fixed costs that stay fixed in dollars (not rising with
 * inflation), such as a fixed-rate mortgage payment. Built for many costs: the closed button
 * summarises the choice, and the open list filters by name.
 */
export function FixedInDollars({
  planned,
  selected,
  onChange,
}: {
  planned: PlannedFixedCosts;
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const list = useId();
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  const chosen = planned.lines.filter((l) => selected.includes(l.fixed_cost_id));
  const annual = chosen.reduce((sum, l) => sum + (decimalToCents(l.annual_amount) ?? 0), 0);
  const shown = planned.lines.filter((l) => l.name.toLowerCase().includes(query.toLowerCase()));
  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);
  const summary =
    chosen.length === 0
      ? "None: every cost rises with inflation"
      : chosen.length <= 2
        ? chosen.map((l) => l.name).join(", ")
        : `${chosen
            .slice(0, 2)
            .map((l) => l.name)
            .join(", ")} +${chosen.length - 2} more`;

  return (
    <div
      ref={root}
      className="field proj-multi"
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <span id={`${list}-label`}>Fixed costs that do not rise with inflation</span>
      <div className="proj-multi-anchor">
        <button
          type="button"
          className="proj-multi-btn"
          aria-expanded={open}
          aria-controls={list}
          aria-labelledby={`${list}-label ${list}-value`}
          onClick={() => setOpen((v) => !v)}
        >
          <span id={`${list}-value`}>{summary}</span>
          <span aria-hidden="true">▾</span>
        </button>
        {open && (
          <div className="proj-multi-pop">
            {planned.lines.length > 6 && (
              <input
                type="search"
                placeholder="Filter fixed costs"
                aria-label="Filter fixed costs"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            )}
            <fieldset id={list}>
              <legend className="sr-only">Fixed costs that do not rise with inflation</legend>
              {shown.map((l) => (
                <label key={l.fixed_cost_id}>
                  <input
                    type="checkbox"
                    checked={selected.includes(l.fixed_cost_id)}
                    onChange={() => toggle(l.fixed_cost_id)}
                  />
                  <span className="proj-multi-name">{l.name}</span>
                  <small>{formatMoney(l.monthly_amount)}/mo</small>
                </label>
              ))}
              {shown.length === 0 && <p className="note">No fixed cost matches.</p>}
            </fieldset>
            <div className="proj-multi-foot">
              <button type="button" className="btn sm" onClick={() => onChange([])}>
                Clear
              </button>
              <button type="button" className="btn pri sm" onClick={() => setOpen(false)}>
                Done
              </button>
            </div>
          </div>
        )}
      </div>
      <small>
        {chosen.length
          ? `${chosen.length} of ${planned.lines.length} costs, ${money(annual)} a year, stay level in the FIRE target.`
          : `All ${planned.lines.length} planned fixed costs rise with inflation.`}
      </small>
    </div>
  );
}
