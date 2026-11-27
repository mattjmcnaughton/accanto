import type { Screen } from "../features/workspace/Workspace";

let start = 0; // First document navigation includes the session bootstrap.
export function beginScreen() {
  start = performance.now();
}

let inboxPaint: (() => void) | undefined;
export function inboxRowsCommitted() {
  inboxPaint?.();
}

/** One aggregate when leaving a sampled visit. Never transmit a location or an event target. */
export function observeScreen(screen: Screen, csrf: string) {
  if (document.hidden || Math.random() >= 0.25 || typeof PerformanceObserver === "undefined")
    return;
  const since = start;
  const sample = {
    screen,
    cold: since === 0,
    shell_ms: 0,
    inbox_ms: 0,
    api_count: 0,
    api_window_ms: 0,
    long_task_ms: 0,
    event_ms: 0,
  };
  let first = Number.POSITIVE_INFINITY;
  let last = 0;
  function collect(entries: PerformanceEntry[]) {
    for (const e of entries) {
      if (e.startTime < since) continue;
      if (e.entryType === "longtask")
        sample.long_task_ms = Math.max(sample.long_task_ms, Math.round(e.duration));
      if (e.entryType === "event" && "interactionId" in e && e.interactionId)
        sample.event_ms = Math.max(sample.event_ms, Math.round(e.duration));
      if (
        e.entryType === "resource" &&
        (e as PerformanceResourceTiming).initiatorType === "fetch" &&
        e.name.startsWith(`${location.origin}/api/`) &&
        !e.name.endsWith("/auth/screen-timing")
      ) {
        sample.api_count++;
        first = Math.min(first, e.startTime);
        last = Math.max(last, e.startTime + e.duration);
        sample.api_window_ms = Math.round(last - first);
      }
    }
  }
  const observer = new PerformanceObserver((list) => collect(list.getEntries()));
  for (const type of ["resource", "event", "longtask"]) {
    if (PerformanceObserver.supportedEntryTypes.includes(type))
      observer.observe({ type, buffered: true, durationThreshold: 16 } as PerformanceObserverInit);
  }
  let done = false;
  const paint = (field: "shell_ms" | "inbox_ms") =>
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (!done && !sample[field]) sample[field] = Math.round(performance.now() - since);
      }),
    );
  paint("shell_ms");
  if (screen === "inbox") inboxPaint = () => paint("inbox_ms");
  function finish() {
    if (done) return;
    done = true;
    inboxPaint = undefined;
    document.removeEventListener("visibilitychange", hidden);
    collect(observer.takeRecords());
    observer.disconnect();
    if (!sample.shell_ms) return;
    void fetch("/api/auth/screen-timing", {
      method: "POST",
      credentials: "same-origin",
      redirect: "error",
      keepalive: true,
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
      body: JSON.stringify(sample),
    }).catch(() => {});
  }
  function hidden() {
    if (document.hidden) finish();
  }
  document.addEventListener("visibilitychange", hidden);
  return finish;
}
