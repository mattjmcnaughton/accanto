import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import type { Entry, Workspace } from "./domain";

export type Update = (next: Workspace, message?: string) => boolean;
export interface ViewProps {
  state: Workspace;
  update: Update;
  openEntry: (entry?: Entry) => void;
}
export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    month: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="3" />
        <path d="M7 3v4m10-4v4M3 11h18m-13 5h2m4 0h2" />
      </>
    ),
    activity: (
      <>
        <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
      </>
    ),
    plans: (
      <>
        <rect x="4" y="3" width="16" height="18" rx="3" />
        <path d="M8 8h8M8 12h8M8 16h4" />
      </>
    ),
    goals: (
      <>
        <circle cx="12" cy="12" r="9" />
        <circle cx="12" cy="12" r="5" />
        <circle cx="12" cy="12" r="1" />
      </>
    ),
    investments: <path d="M3 20h18M5 16l5-5 4 3 7-10m-6 0h6v6" />,
    giving: <path d="M12 20S3 14 3 8a5 5 0 0 1 9-3 5 5 0 0 1 9 3c0 6-9 12-9 12Z" />,
    plus: <path d="M12 5v14M5 12h14" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    arrow: <path d="m9 5 7 7-7 7" />,
    back: <path d="m15 5-7 7 7 7" />,
    down: <path d="m6 9 6 6 6-6" />,
    search: (
      <>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m16 16 5 5" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    settings: (
      <>
        <path d="M4 7h16M4 17h16" />
        <circle cx="8" cy="7" r="3" />
        <circle cx="16" cy="17" r="3" />
      </>
    ),
    edit: (
      <>
        <path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-4-4L5 15l-1 5Z" />
      </>
    ),
    trash: (
      <>
        <path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7" />
      </>
    ),
    download: (
      <>
        <path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" />
      </>
    ),
    copy: (
      <>
        <rect x="8" y="8" width="13" height="13" rx="2" />
        <path d="M16 8V3H3v13h5" />
      </>
    ),
    info: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v6m0-10h.01" />
      </>
    ),
    wallet: (
      <>
        <rect x="3" y="5" width="18" height="15" rx="3" />
        <path d="M3 8h18m0 5h-6v4h6" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] ?? paths.info}
    </svg>
  );
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const label = useId();
  useEffect(() => {
    const el = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    el?.showModal();
    el?.querySelector<HTMLElement>('input:not([type="checkbox"]), textarea, select')?.focus();
    return () => {
      el?.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? "wide" : ""}`}
      aria-labelledby={label}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="modal-head">
        <h2 id={label}>{title}</h2>
        <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function MoneyField({
  label,
  value,
  onChange,
  optional = false,
  signed = false,
  hint,
  required = false,
}: {
  label: string;
  value: number | null;
  onChange: (n: number | null) => void;
  optional?: boolean;
  signed?: boolean;
  hint?: string;
  required?: boolean;
}) {
  const [text, setText] = useState(
    value === null || (value === 0 && !optional) ? "" : String(value / 100),
  );
  const focused = useRef(false);
  const inputId = useId();
  useEffect(() => {
    if (!focused.current)
      setText(value === null || (value === 0 && !optional) ? "" : String(value / 100));
  }, [value, optional]);
  return (
    <label className="field" htmlFor={inputId}>
      <span id={`${inputId}-label`}>{label}</span>
      <span className="money-input">
        <span>$</span>
        <input
          id={inputId}
          aria-labelledby={`${inputId}-label`}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          placeholder={optional ? "Not set" : "0.00"}
          value={text}
          required={required}
          onFocus={() => {
            focused.current = true;
          }}
          onBlur={() => {
            focused.current = false;
            if (text === "-" || text === ".") {
              setText("");
              onChange(optional ? null : 0);
            }
          }}
          onChange={(e) => {
            const v = e.target.value;
            if (!(signed ? /^-?\d{0,9}(\.\d{0,2})?$/ : /^\d{0,9}(\.\d{0,2})?$/).test(v)) return;
            setText(v);
            onChange(
              v === "" || v === "-" || v === "."
                ? optional
                  ? null
                  : 0
                : Math.round(Number(v) * 100),
            );
          }}
        />
      </span>
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function Empty({
  icon,
  title,
  children,
  action,
}: { icon: string; title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon name={icon} size={28} />
      </div>
      <h2>{title}</h2>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function PageHead({
  title,
  description,
  actions,
}: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <header className="page-head">
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}
export function Notice({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return (
    <div className={error ? "notice error" : "notice"} role={error ? "alert" : undefined}>
      <Icon name="info" size={18} />
      <div>{children}</div>
    </div>
  );
}
