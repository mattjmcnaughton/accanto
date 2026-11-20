import "./recovery.css";

/** Status and actions for a pending in-memory write; form values remain with its owner. */
export type RecoveryStatus =
  | "unavailable"
  | "unauthenticated"
  | "conflict"
  | "validation"
  | "blocked"
  | "cancelled"
  | "failed"
  | "wrong_user";

const messages: Record<RecoveryStatus, string> = {
  unavailable: "Save was not confirmed. Your input is still here. Retry with the same request.",
  unauthenticated: "Your sign-in expired. Sign in in a separate window to retry this save.",
  conflict:
    "This record changed elsewhere. Reload it and reconcile your input before saving again.",
  validation: "The input needs correction. Your entries are still here.",
  blocked: "The sign-in window was blocked. Allow popups and try again; your input is still here.",
  cancelled: "Sign-in was cancelled. Your input is still here.",
  failed: "Sign-in could not be verified. Your input is still here.",
  wrong_user:
    "A different User signed in. Pending input is hidden and cannot be submitted in this account.",
};

export function RecoveryNotice({
  status,
  onRetry,
  onSignIn,
  onReconcile,
  onDiscard,
}: {
  status: RecoveryStatus;
  onRetry: () => void;
  onSignIn: () => void;
  onReconcile: () => void;
  onDiscard: () => void;
}) {
  return (
    <section className="recovery-notice" role="alert" aria-label="Save needs attention">
      <p>{messages[status]}</p>
      <div className="recovery-actions">
        {status === "unavailable" && (
          <button type="button" className="btn sm pri" onClick={onRetry}>
            Retry save
          </button>
        )}
        {(
          ["unauthenticated", "blocked", "cancelled", "failed", "wrong_user"] as RecoveryStatus[]
        ).includes(status) && (
          <button type="button" className="btn sm pri" onClick={onSignIn}>
            Sign in in a new window
          </button>
        )}
        {status === "conflict" && (
          <button type="button" className="btn sm pri" onClick={onReconcile}>
            Review current record
          </button>
        )}
        {status !== "wrong_user" && (
          <button type="button" className="btn sm" onClick={onDiscard}>
            Discard pending save
          </button>
        )}
      </div>
    </section>
  );
}
