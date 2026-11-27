import { type KeyboardEvent, useId, useState } from "react";

export type ComboOption = { id: string; name: string; note?: string };
/** A name for a new record, typed in a picker that does not have it yet. */
export type ComboCreate = {
  /** What a new record is called, such as "spending subcategory". */
  noun: string;
  /** Names the new record may not repeat, archived ones included. Compared ignoring case. */
  taken: string[];
  onCreate: (name: string) => void;
};

const CREATE = "\u0000create";
/** Names compare as the server stores them: whitespace collapsed, case ignored. */
export const cleanName = (name: string) => name.trim().replace(/\s+/g, " ");
export const sameName = (a: string, b: string) =>
  cleanName(a).toLowerCase() === cleanName(b).toLowerCase();

/**
 * A text box that filters a list of records: type to narrow, ↑ ↓ to move, Enter to choose and
 * Esc to leave it as it was. With `create`, a name that matches nothing can become a new record.
 * Nothing changes until an option is chosen.
 */
export function Combobox({
  id,
  name,
  label,
  options,
  value,
  onChange,
  create,
  placeholder,
  disabled,
  required,
  invalid,
}: {
  id?: string;
  name?: string;
  /** The accessible name when no visible label wraps the box. */
  label?: string;
  options: ComboOption[];
  value: string;
  onChange: (id: string) => void;
  create?: ComboCreate;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  invalid?: boolean;
}) {
  const list = useId();
  const [query, setQuery] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(0);
  const selected = options.find((option) => option.id === value);
  const typed = query === null ? "" : cleanName(query);
  const shown = typed
    ? options.filter((option) =>
        `${option.name} ${option.note ?? ""}`.toLowerCase().includes(typed.toLowerCase()),
      )
    : options;
  const creatable =
    create &&
    typed.length > 0 &&
    typed.length <= 120 &&
    ![...options.map((option) => option.name), ...create.taken].some((taken) =>
      sameName(taken, typed),
    );
  const rows: ComboOption[] = creatable
    ? [...shown, { id: CREATE, name: `Create “${typed}”`, note: `New ${create.noun}` }]
    : shown;
  const current = Math.min(at, rows.length - 1);
  function close() {
    setOpen(false);
    setQuery(null);
    setAt(0);
  }
  function choose(row: ComboOption) {
    close();
    if (row.id === CREATE) create?.onCreate(typed);
    else onChange(row.id);
  }
  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        setAt(
          Math.max(
            0,
            rows.findIndex((row) => row.id === value),
          ),
        );
      } else
        setAt(
          e.key === "ArrowDown" ? Math.min(rows.length - 1, current + 1) : Math.max(0, current - 1),
        );
    } else if (e.key === "Enter" && open) {
      // Enter chooses here instead of submitting the form around the box.
      e.preventDefault();
      if (rows[current]) choose(rows[current]);
    } else if (e.key === "Escape" && (open || query !== null)) {
      // Esc leaves the choice as it was, without closing a dialog around the box.
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  }
  const active = open && rows[current] ? `${list}-${current}` : undefined;
  return (
    <span className="combo">
      <input
        id={id}
        name={name}
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={list}
        aria-autocomplete="list"
        aria-activedescendant={active}
        aria-invalid={invalid || undefined}
        autoComplete="off"
        maxLength={120}
        required={required && !value}
        disabled={disabled}
        placeholder={selected ? undefined : placeholder}
        value={query ?? selected?.name ?? ""}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setAt(0);
        }}
        onFocus={(e) => e.currentTarget.select()}
        onClick={() => setOpen(true)}
        onBlur={close}
        onKeyDown={onKeyDown}
      />
      {open && (
        // biome-ignore lint/a11y/useSemanticElements: A filtered list the box above owns; a select cannot filter.
        <div id={list} role="listbox" tabIndex={-1} className="combo-list" aria-label={label}>
          {rows.map((row, index) => (
            <div
              key={row.id}
              id={`${list}-${index}`}
              // biome-ignore lint/a11y/useSemanticElements: An option of the listbox above.
              role="option"
              tabIndex={-1}
              aria-selected={index === current}
              className={row.id === CREATE ? "combo-new" : undefined}
              // Keep focus in the box, so a click chooses before the box closes on blur.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(row)}
              onKeyDown={undefined}
            >
              <span>{row.name}</span>
              {row.note && <small>{row.note}</small>}
            </div>
          ))}
          {rows.length === 0 && <p className="combo-none">{`Nothing matches “${typed}”.`}</p>}
        </div>
      )}
    </span>
  );
}
