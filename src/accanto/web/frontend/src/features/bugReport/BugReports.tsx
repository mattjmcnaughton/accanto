import { useState } from "react";
import { type BrowserSession, fetchJson, loadResource } from "../../lib/api";
import type { ReportContext, ReportKind } from "../../lib/bugReport";
import { fmtDate } from "../../lib/format";
import { parseTimestamp } from "../../lib/timestamp";
import { useLoad } from "../workspace/shared";

type Status = "open" | "done" | "wont_do";
interface Report {
  id: string;
  kind: ReportKind;
  note: string;
  context: ReportContext;
  status: Status;
  created_at: string;
  resolved_at: string | null;
}
const KIND: Record<ReportKind, [string, string]> = {
  bug: ["Bug", "bad"],
  idea: ["Idea", "good"],
  fix: ["Fix", "warn"],
};
const STATUS: Record<Status, string> = { open: "Open", done: "Done", wont_do: "Won't do" };
const day = (value: string) => {
  const ms = parseTimestamp(value);
  return ms === null ? value : fmtDate(new Date(ms).toLocaleDateString("en-CA"));
};

/** Settings › Report bug (TDD 21): the opted-in User's reports, newest first. */
export function BugReports({
  credentials,
  disabled,
}: { credentials: () => Promise<BrowserSession>; disabled: boolean }) {
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [showDone, setShowDone] = useState(false);
  const state = useLoad(() => loadResource<Report[]>("/api/bug-reports", () => false), [attempt]);
  async function change(id: string, status: Status) {
    setBusy(true);
    setMessage("");
    try {
      const session = await credentials();
      await fetchJson(`/api/bug-reports/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": session.csrf_token },
        body: JSON.stringify({ status }),
      });
      setAttempt((x) => x + 1);
    } catch {
      setMessage("The change was not saved. Reload the list and try again.");
    } finally {
      setBusy(false);
    }
  }
  const reports = state.kind === "ready" ? state.data : [];
  const open = reports.filter((r) => r.status === "open");
  const shown = showDone ? reports : open;
  return (
    <section aria-labelledby="bug-reports-heading">
      <h2 className="h2" id="bug-reports-heading">
        Report bug{" "}
        <span>
          Notes you filed with <kbd className="kbd">Ctrl .</kbd> or the bug button. Only you see
          them.
        </span>
      </h2>
      {"error" in state && (
        <div className="banner bad" role="alert">
          <span>Could not load reports. {state.error.message}</span>
          <button type="button" className="btn sm" onClick={() => setAttempt((x) => x + 1)}>
            Try loading again
          </button>
        </div>
      )}
      <div className="card">
        {state.kind === "loading" && (
          <output className="setting" aria-label="Loading reports">
            <span className="sk set-sk" />
          </output>
        )}
        {message && (
          <div className="setting">
            <output>{message}</output>
          </div>
        )}
        {state.kind === "ready" && shown.length === 0 && (
          <div className="setting">
            <span className="muted">{reports.length ? "No open reports." : "No reports yet."}</span>
          </div>
        )}
        {shown.map((report) => (
          <div className="setting" key={report.id}>
            <div>
              <span className={`chip ${KIND[report.kind][1]}`}>{KIND[report.kind][0]}</span>{" "}
              {report.note}
              <small>
                {report.context.screen} · build {report.context.build} ·{" "}
                {report.context.viewport.width}×{report.context.viewport.height} ·{" "}
                {day(report.created_at)}
                {report.context.api.some((call) => call.status === null || call.status >= 400) &&
                  ` · ${report.context.api
                    .filter((call) => call.status === null || call.status >= 400)
                    .map((call) => `${call.status ?? "no response"} ${call.code ?? ""}`.trim())
                    .join(", ")}`}
              </small>
            </div>
            <label className="set-actions">
              <span className="sr-only">Status of “{report.note}”</span>
              <select
                className="input"
                value={report.status}
                disabled={busy || disabled}
                onChange={(event) => void change(report.id, event.target.value as Status)}
              >
                {(Object.keys(STATUS) as Status[]).map((status) => (
                  <option key={status} value={status}>
                    {STATUS[status]}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ))}
        {state.kind === "ready" && reports.length > open.length && (
          <div className="setting">
            <small>{reports.length - open.length} done or won't do</small>
            <button
              type="button"
              className="btn sm quiet"
              aria-pressed={showDone}
              onClick={() => setShowDone((x) => !x)}
            >
              {showDone ? "Hide closed" : "Show closed"}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
