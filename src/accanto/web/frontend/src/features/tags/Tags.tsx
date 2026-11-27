import { useState } from "react";
import type { UUID } from "../../lib/api";
import { plural } from "../../lib/format";
import type { WriteSpec } from "../../lib/monthly";
import { type Tag, tags as tagApi } from "../../lib/tags";
import { Combobox, Dialog, Field } from "../../ui";
import "./tags.css";

/** Selected tags as removable chips, plus a menu of active tags to add. */
export function TagPicker({
  tags,
  value,
  onChange,
  label = "Tags",
  disabled = false,
  onCreate,
}: {
  tags: Tag[];
  value: UUID[];
  onChange: (next: UUID[]) => void;
  label?: string;
  disabled?: boolean;
  /** Create a tag from a typed name that no tag has; the caller adds it once it exists. */
  onCreate?: (name: string) => void;
}) {
  const name = (id: UUID) => tags.find((tag) => tag.uuid === id)?.name ?? "Deleted tag";
  const addable = tags.filter((tag) => tag.active && !value.includes(tag.uuid));
  return (
    <Field
      label={label}
      hint={tags.length || onCreate ? undefined : "Create tags with Manage tags."}
    >
      <div className="tag-picker">
        {value.map((id) => {
          const archived = tags.find((tag) => tag.uuid === id)?.active === false;
          return (
            <span key={id} className="chip tag-chip">
              {name(id)}
              {archived && " (archived)"}
              <button
                type="button"
                className="tag-x"
                aria-label={`Remove tag ${name(id)}`}
                disabled={disabled}
                onClick={() => onChange(value.filter((other) => other !== id))}
              >
                ×
              </button>
            </span>
          );
        })}
        {(addable.length > 0 || onCreate) && (
          <span className="tag-add">
            <Combobox
              label={`Add a tag (${label})`}
              placeholder={onCreate ? "Add or create a tag…" : "Add a tag…"}
              options={addable.map((tag) => ({ id: tag.uuid, name: tag.name }))}
              value=""
              disabled={disabled}
              onChange={(id) => onChange([...value, id])}
              create={
                onCreate && {
                  noun: "tag",
                  taken: tags.map((tag) => tag.name),
                  onCreate,
                }
              }
            />
          </span>
        )}
        {value.length === 0 && addable.length === 0 && !onCreate && (
          <span className="note">No tags</span>
        )}
      </div>
    </Field>
  );
}

/** Tag names on an entry row; archived and deleted names stay readable. */
export function TagChips({ tags, ids }: { tags: Tag[]; ids: UUID[] | undefined }) {
  if (!ids?.length) return null;
  return (
    <>
      {ids.map((id) => (
        <span key={id} className="chip tag-chip">
          {tags.find((tag) => tag.uuid === id)?.name ?? "Deleted tag"}
        </span>
      ))}
    </>
  );
}

type Save = <T>(spec: WriteSpec<T>, confirmed: (data: T) => void) => void;

/** Create, rename, archive, restore and delete the Entity's tags. */
export function TagsDialog({
  entityId,
  tags,
  busy,
  save,
  onClose,
}: {
  entityId: UUID;
  tags: Tag[];
  busy: boolean;
  save: Save;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState<{ id: UUID; name: string } | null>(null);
  const [confirming, setConfirming] = useState<UUID | null>(null);
  const edit = (tag: Tag, change: Partial<Pick<Tag, "name" | "active">>) =>
    save(
      tagApi.edit(entityId, tag.uuid, {
        name: change.name ?? tag.name,
        active: change.active ?? tag.active,
        expected_revision: tag.revision,
      }),
      () => setRenaming(null),
    );
  return (
    <Dialog title="Manage tags" onClose={onClose} className="tags-dlg">
      <div className="dlg-b">
        <p className="note">
          Tags label entries in any category, such as a trip or a person. An entry can carry
          several, so tagged amounts overlap and are not shares of a category total.
        </p>
        <form
          className="tag-new"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) save(tagApi.create(entityId, { name }), () => setName(""));
          }}
        >
          <input
            className="input"
            aria-label="New tag name"
            placeholder="New tag, for example Italy trip"
            maxLength={120}
            value={name}
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
          />
          <button type="submit" className="btn pri" disabled={busy || !name.trim()}>
            Add tag
          </button>
        </form>
        {tags.length === 0 ? (
          <p className="note">No tags yet.</p>
        ) : (
          <ul className="tag-list" aria-label="Tags">
            {tags.map((tag) => (
              <li key={tag.uuid}>
                {renaming?.id === tag.uuid ? (
                  <form
                    className="tag-new"
                    onSubmit={(e) => {
                      e.preventDefault();
                      edit(tag, { name: renaming.name });
                    }}
                  >
                    <input
                      className="input"
                      aria-label={`New name for ${tag.name}`}
                      maxLength={120}
                      value={renaming.name}
                      onChange={(e) => setRenaming({ id: tag.uuid, name: e.target.value })}
                    />
                    <button type="submit" className="btn" disabled={busy || !renaming.name.trim()}>
                      Save
                    </button>
                    <button type="button" className="btn" onClick={() => setRenaming(null)}>
                      Cancel
                    </button>
                  </form>
                ) : (
                  <>
                    <span className="tag-name">
                      {tag.name}
                      {!tag.active && <span className="chip">Archived</span>}
                    </span>
                    <span className="note">{plural(tag.entries, "entry", "entries")}</span>
                    <span className="spacer" />
                    {confirming === tag.uuid ? (
                      <>
                        <span className="note">
                          Remove from {plural(tag.entries, "entry", "entries")}?
                        </span>
                        <button
                          type="button"
                          className="btn danger"
                          disabled={busy}
                          onClick={() =>
                            save(
                              tagApi.remove(entityId, tag.uuid, {
                                expected_revision: tag.revision,
                              }),
                              () => setConfirming(null),
                            )
                          }
                        >
                          Delete tag
                        </button>
                        <button type="button" className="btn" onClick={() => setConfirming(null)}>
                          Keep
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="btn"
                          disabled={busy}
                          onClick={() => setRenaming({ id: tag.uuid, name: tag.name })}
                        >
                          Rename
                        </button>
                        <button
                          type="button"
                          className="btn"
                          disabled={busy}
                          onClick={() => edit(tag, { active: !tag.active })}
                        >
                          {tag.active ? "Archive" : "Restore"}
                        </button>
                        <button
                          type="button"
                          className="btn"
                          disabled={busy}
                          onClick={() => setConfirming(tag.uuid)}
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="dlg-f">
        <span className="spacer" />
        <button type="button" className="btn" onClick={onClose}>
          Done
        </button>
      </div>
    </Dialog>
  );
}
