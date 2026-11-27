import { useState } from "react";
import type { UUID } from "../../lib/api";
import { plural } from "../../lib/format";
import type { WriteSpec } from "../../lib/monthly";
import {
  type SpendingSubcategory,
  spendingSubcategories as api,
} from "../../lib/spendingSubcategories";
import { Dialog } from "../../ui";
import "./tags.css";

type Save = <T>(spec: WriteSpec<T>, confirmed: (data: T) => void) => void;

/** Create, rename, archive and restore guilt-free spending's subcategories. Never deleted. */
export function SubcategoriesDialog({
  entityId,
  subcategories,
  busy,
  save,
  onClose,
}: {
  entityId: UUID;
  subcategories: SpendingSubcategory[];
  busy: boolean;
  save: Save;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState<{ id: UUID; name: string } | null>(null);
  const edit = (
    sub: SpendingSubcategory,
    change: Partial<Pick<SpendingSubcategory, "name" | "active">>,
  ) =>
    save(
      api.edit(entityId, sub.uuid, {
        name: change.name ?? sub.name,
        active: change.active ?? sub.active,
        expected_revision: sub.revision,
      }),
      () => setRenaming(null),
    );
  return (
    <Dialog title="Spending subcategories" onClose={onClose} className="tags-dlg">
      <div className="dlg-b">
        <form
          className="tag-new"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) save(api.create(entityId, { name }), () => setName(""));
          }}
        >
          <input
            className="input"
            aria-label="New subcategory name"
            placeholder="New subcategory, for example Eating out"
            maxLength={120}
            value={name}
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
          />
          <button type="submit" className="btn pri" disabled={busy || !name.trim()}>
            Add subcategory
          </button>
        </form>
        {subcategories.length === 0 ? (
          <p className="note">No subcategories yet.</p>
        ) : (
          <ul className="tag-list" aria-label="Spending subcategories">
            {subcategories.map((sub) => (
              <li key={sub.uuid}>
                {renaming?.id === sub.uuid ? (
                  <form
                    className="tag-new"
                    onSubmit={(e) => {
                      e.preventDefault();
                      edit(sub, { name: renaming.name });
                    }}
                  >
                    <input
                      className="input"
                      aria-label={`New name for ${sub.name}`}
                      maxLength={120}
                      value={renaming.name}
                      onChange={(e) => setRenaming({ id: sub.uuid, name: e.target.value })}
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
                      {sub.name}
                      {!sub.active && <span className="chip">Archived</span>}
                    </span>
                    <span className="note">{plural(sub.entries, "entry", "entries")}</span>
                    <span className="spacer" />
                    <button
                      type="button"
                      className="btn"
                      disabled={busy}
                      onClick={() => setRenaming({ id: sub.uuid, name: sub.name })}
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      className="btn"
                      disabled={busy}
                      onClick={() => edit(sub, { active: !sub.active })}
                    >
                      {sub.active ? "Archive" : "Restore"}
                    </button>
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
