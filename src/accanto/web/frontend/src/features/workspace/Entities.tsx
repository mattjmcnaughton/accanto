import { useState } from "react";
import type { UUID } from "../../lib/api";
import type { WriteSpec } from "../../lib/monthly";
import { Dialog, Field } from "../../ui";
import type { Entity } from "./shared";

/** Only the last-used Entity's ID is remembered; never its name or any financial data. */
const LAST_ENTITY = "accanto.entity";
export function lastEntity(): string | null {
  try {
    return window.localStorage.getItem(LAST_ENTITY);
  } catch {
    return null;
  }
}
export function rememberEntity(id: UUID) {
  try {
    window.localStorage.setItem(LAST_ENTITY, id);
  } catch {
    // Storage can be unavailable; the address still names the Entity.
  }
}

export const createEntity = (body: {
  name: string;
  time_zone: string;
}): WriteSpec<{ id: UUID; name: string; time_zone: string; revision: number }> => ({
  method: "POST",
  path: "/api/entities",
  body,
});

const CREATE = "__create__";

/** The current Entity, prominently, and a switch to the User's other Entities. */
export function EntitySwitcher({
  entities,
  current,
  disabled,
  choose,
  create,
  className = "",
}: {
  className?: string;
  entities: Entity[];
  current: Entity;
  disabled: boolean;
  choose: (id: UUID) => void;
  create: () => void;
}) {
  return (
    <label className={`entity-switch ${className}`}>
      <span className="sr-only">Entity</span>
      <select
        className="input"
        aria-label="Entity"
        value={current.id}
        disabled={disabled}
        onChange={(event) => {
          const value = event.target.value;
          if (value === CREATE) create();
          else if (value !== current.id) choose(value);
        }}
      >
        {entities.map((e) => (
          <option key={e.id} value={e.id}>
            {e.name}
          </option>
        ))}
        <option value={CREATE}>Create Entity…</option>
      </select>
    </label>
  );
}

// Suggestions only; the server remains the time zone validator.
const zones =
  (Intl as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];

/** Create Entity: a name and time zone. It starts empty; nothing is copied. */
export function CreateEntityDialog({
  zone,
  busy,
  submit,
  close,
}: {
  zone: string;
  busy: boolean;
  submit: (body: { name: string; time_zone: string }) => void;
  close: () => void;
}) {
  const [name, setName] = useState("");
  const [timeZone, setTimeZone] = useState(zone);
  return (
    <Dialog title="Create Entity" onClose={close}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit({ name: name.trim(), time_zone: timeZone.trim() });
        }}
      >
        <fieldset className="dlg-b" disabled={busy}>
          <p className="note">
            A separate set of finances, such as Personal next to Family. It starts empty, and its
            totals are never combined with another Entity's.
          </p>
          <Field label="Entity name">
            <input
              className="input"
              required
              maxLength={120}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field label="Time zone" hint="An IANA zone, such as America/Chicago or UTC.">
            <input
              className="input"
              required
              list="create-entity-zones"
              spellCheck={false}
              autoComplete="off"
              value={timeZone}
              onChange={(event) => setTimeZone(event.target.value)}
            />
          </Field>
          <datalist id="create-entity-zones">
            {zones.map((z) => (
              <option key={z} value={z} />
            ))}
          </datalist>
        </fieldset>
        <div className="dlg-f">
          <button type="button" className="btn quiet" onClick={close}>
            Cancel
          </button>
          <button type="submit" className="btn pri" disabled={busy || !name.trim()}>
            Create Entity
          </button>
        </div>
      </form>
    </Dialog>
  );
}
