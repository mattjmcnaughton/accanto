import type { InboxCategory, StagedTransaction } from "../../lib/inbox";
import { fmtMonth, money } from "../../lib/format";
import { tint } from "../../ui";
import { CATEGORY, cents } from "./inboxModel";

/**
 * How inbox zero looks. Storybook compares the three; the app uses `card`.
 * - card: a calm centered card with this session's tally and the next step.
 * - ledger: the same card with the session's recorded amounts by category.
 * - quiet: one line in the inbox's own layout, no card.
 */
export type ZeroStyle = "card" | "ledger" | "quiet";
/** An item that stopped waiting while this screen was open, and its category once recorded. */
export type Cleared = { it: StagedTransaction; category: InboxCategory | null };

const focus = (el: HTMLElement | null) => el?.focus({ preventScroll: true });

/** Nothing waits and nothing conflicts: every imported item is recorded or ignored. */
export function InboxZero({
  look = "card",
  cleared,
  sourceName,
  lastSynced,
  timeZone,
  month,
  syncing,
  busy,
  sync,
  openReview,
  flow,
}: {
  look?: ZeroStyle;
  cleared: Cleared[];
  sourceName: string;
  lastSynced: string | null;
  timeZone: string;
  month: string;
  syncing: boolean;
  busy: boolean;
  sync: () => void;
  openReview?: () => void;
  /** At the end of a flow pass: undo the last decision or go back to the list. */
  flow?: { undo: () => void; leave: () => void };
}) {
  const recorded = cleared.filter((c) => c.it.status === "recorded");
  const ignored = cleared.length - recorded.length;
  // Ignored items are in no total, so the amount is what was recorded.
  const total = recorded.reduce((sum, c) => sum + Math.abs(cents(c.it)), 0);
  const tally = cleared.length
    ? `${cleared.length} cleared this session · ${recorded.length} recorded${
        recorded.length ? `, ${money(total)}` : ""
      } · ${ignored} ignored`
    : "Nothing new since the last sync.";
  const synced = lastSynced
    ? new Intl.DateTimeFormat("en-US", {
        timeZone,
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(lastSynced))
    : null;
  const syncLine = (
    <p className="ix-zero-sync">
      <span>{synced ? `${sourceName} last synced ${synced}` : `${sourceName} not synced yet`}</span>
      <button
        type="button"
        className="btn sm"
        disabled={busy || syncing}
        aria-busy={syncing}
        onClick={sync}
      >
        {syncing ? "Syncing…" : "Sync now"}
      </button>
    </p>
  );
  const actions = (
    <div className="ix-do">
      {openReview && (
        <button type="button" className="btn pri" onClick={openReview}>
          Open {fmtMonth(month)} Review
        </button>
      )}
      {flow && (
        <>
          <button type="button" className="btn" onClick={flow.leave}>
            Back to the inbox <kbd className="kbd">Esc</kbd>
          </button>
          <button type="button" className="btn quiet" onClick={flow.undo}>
            Undo last <kbd className="kbd">z</kbd>
          </button>
        </>
      )}
    </div>
  );
  const check = (
    <svg className="ix-zero-mark" viewBox="0 0 40 40" aria-hidden="true">
      <circle cx="20" cy="20" r="18" />
      <path d="M12.5 20.5l5 5 10-11" />
    </svg>
  );

  if (look === "quiet")
    return (
      <section className="ix-zero quiet" aria-label="Inbox zero">
        <p className="ix-zero-line">
          {check}
          <b>Inbox zero</b>
          <span>{tally}</span>
        </p>
        {syncLine}
        {actions}
      </section>
    );

  const byCategory = Object.entries(
    recorded.reduce<Record<string, number>>((acc, c) => {
      const key = c.category ?? "other";
      acc[key] = (acc[key] ?? 0) + Math.abs(cents(c.it));
      return acc;
    }, {}),
  );
  return (
    <section
      className="ix-card ix-zero"
      aria-label="Inbox zero"
      // At the end of a flow pass the card takes focus, as each flow card does.
      ref={flow ? focus : undefined}
      tabIndex={-1}
    >
      {check}
      <div className="ix-d-t">Inbox zero</div>
      <p>
        {flow ? "That was the last one. " : ""}Every transaction from {sourceName} is recorded or
        ignored.
      </p>
      <p className="ix-zero-tally">{tally}</p>
      {look === "ledger" && byCategory.length > 0 && (
        <dl className="ix-zero-ledger">
          {byCategory.map(([key, amount]) => (
            <div key={key}>
              <dt>
                <i className="dot" style={tint(CATEGORY[key as InboxCategory]?.kind ?? "none")} />
                {CATEGORY[key as InboxCategory]?.name ?? "Refunds and other"}
              </dt>
              <dd>{money(amount)}</dd>
            </div>
          ))}
        </dl>
      )}
      {syncLine}
      {actions}
    </section>
  );
}
