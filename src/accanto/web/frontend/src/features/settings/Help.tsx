import type { ReactNode } from "react";

/** Optional explanation behind a native disclosure; Escape closes it and returns focus. */
export function Help({ label, id, children }: { label: string; id?: string; children: ReactNode }) {
  return (
    <details
      className="settings-help"
      onKeyDown={(event) => {
        if (event.key === "Escape" && event.currentTarget.open) {
          event.preventDefault();
          event.currentTarget.open = false;
          event.currentTarget.querySelector("summary")?.focus();
        }
      }}
    >
      <summary aria-label={label}>?</summary>
      <p id={id}>{children}</p>
    </details>
  );
}
