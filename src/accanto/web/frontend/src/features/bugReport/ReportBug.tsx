import { useEffect, useRef, useState } from "react";
import { type BrowserSession, fetchJson } from "../../lib/api";
import { type ReportKind, reportContext } from "../../lib/bugReport";
import "./reportBug.css";

const KINDS: [ReportKind, string][] = [
  ["bug", "Bug"],
  ["idea", "Idea"],
  ["fix", "Fix"],
];

/**
 * Report bug (TDD 21): a bubble in the corner and Ctrl/⌘ + . open a one-line form. Saving
 * never changes the screen; a failed save keeps the note for another try.
 */
export function ReportBug({
  open,
  setOpen,
  screen,
  month,
  credentials,
  saved,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  screen: string;
  month: string | null;
  credentials: () => Promise<BrowserSession>;
  saved: (message: string) => void;
}) {
  const [note, setNote] = useState("");
  const [kind, setKind] = useState<ReportKind>("bug");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [scrolling, setScrolling] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const bubble = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) field.current?.focus();
  }, [open]);
  // On a phone the bubble steps aside while the page scrolls.
  useEffect(() => {
    let timer = 0;
    const onScroll = () => {
      setScrolling(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setScrolling(false), 400);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.clearTimeout(timer);
    };
  }, []);

  function close() {
    setOpen(false);
    setError("");
    bubble.current?.focus({ preventScroll: true });
  }
  async function submit() {
    if (!note.trim() || sending) return;
    setSending(true);
    setError("");
    try {
      const session = await credentials();
      const report = await fetchJson<{ id: string }>("/api/bug-reports", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": session.csrf_token },
        body: JSON.stringify({ kind, note: note.trim(), context: reportContext(screen, month) }),
      });
      if (!report) throw new Error("No report");
      setNote("");
      setKind("bug");
      close();
      saved("Report saved.");
    } catch {
      setError("The report was not saved. Your note is still here; try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className={`rb${open ? " open" : ""}${scrolling && !open ? " away" : ""}`}>
      {open && (
        // biome-ignore lint/a11y/useKeyWithClickEvents: Escape closes the form from its own key handler.
        <div className="rb-scrim" onClick={close} />
      )}
      {open && (
        <form
          className="rb-form"
          aria-label="Report bug"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              close();
            } else if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
              event.preventDefault();
              void submit();
            }
          }}
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="rb-grab" />
          <div className="rb-head">
            <strong>Report bug</strong>
            <span className="kbd rb-desk">Esc</span>
          </div>
          <label className="sr-only" htmlFor="rb-note">
            What happened, or what should change?
          </label>
          <textarea
            id="rb-note"
            ref={field}
            className="input rb-note"
            rows={2}
            maxLength={2000}
            placeholder="What happened, or what should change?"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          <fieldset className="rb-kinds" aria-label="Type">
            {KINDS.map(([value, label]) => (
              <button
                key={value}
                type="button"
                className="rb-kind"
                aria-pressed={kind === value}
                onClick={() => setKind(value)}
              >
                {label}
              </button>
            ))}
          </fieldset>
          <p className="rb-ctx">
            Attaches this screen, the build, window size, recent API calls and error names. Never
            what is on the page.
          </p>
          {error && (
            <p className="rb-error" role="alert">
              {error}
            </p>
          )}
          <div className="rb-foot">
            <span className="rb-ctx">Saved to Accanto only</span>
            <span className="rb-actions">
              <span className="kbd rb-desk">Ctrl ↵</span>
              <button
                type="submit"
                className="btn pri sm"
                disabled={sending || !note.trim()}
                aria-keyshortcuts="Control+Enter Meta+Enter"
              >
                {sending ? "Saving…" : "Save"}
              </button>
            </span>
          </div>
        </form>
      )}
      <button
        ref={bubble}
        type="button"
        className="rb-bubble"
        aria-label="Report bug"
        aria-expanded={open}
        aria-keyshortcuts="Control+. Meta+."
        onClick={() => (open ? close() : setOpen(true))}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="m8 2 1.88 1.88M14.12 3.88 16 2M9 7.13v-1a3 3 0 1 1 6 0v1M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6M12 20v-9M6.53 9C4.6 8.8 3 7.1 3 5M6 13H2M3 21c0-2.1 1.7-3.9 3.8-4M20.97 5c0 2.1-1.6 3.8-3.5 4M22 13h-4M17.2 17c2.1.1 3.8 1.9 3.8 4" />
        </svg>
        <span className="rb-label">Report bug</span>
        <span className="kbd rb-label">Ctrl .</span>
      </button>
    </div>
  );
}
