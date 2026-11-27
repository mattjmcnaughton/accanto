import { useEffect, useMemo, useState } from "react";
import { agent } from "../../lib/agentStream";
import { fmtMonth, monthName } from "../../lib/format";
import { monthly } from "../../lib/monthly";
import { Dialog, Icon } from "../../ui";
import { Hero, MonthBreakdown } from "./Home";
import { type Entity, LoadMessage, composing, useLoad } from "./shared";

/** A screen or an action the workspace runs; `slash` also makes it a / command. */
export type Action = { text: string; hint: string; run: () => void; slash?: string };
type Card = "left" | "month";
type Row =
  | { kind: "ask"; text: string; hint: string }
  | { kind: "card"; card: Card; text: string; hint: string; slash: string }
  | ({ kind: "action" } & Action);

/** Commands that show a card here, read from the API like Home: no model is involved. */
const CARDS: Extract<Row, { kind: "card" }>[] = [
  { kind: "card", card: "left", text: "What's left to spend", hint: "Card", slash: "/left" },
  {
    kind: "card",
    card: "month",
    text: "Where this month's money is going",
    hint: "Card",
    slash: "/month",
  },
];
/**
 * Phrases to tap instead of typing. A phrase with a command runs it without the model; the
 * others go to the assistant as written.
 */
const SUGGESTED: { text: string; slash?: string }[] = [
  { text: "Process my inbox", slash: "/inbox" },
  { text: "What's left to spend this month?", slash: "/left" },
  { text: "How much did we spend on eating out this month?" },
  { text: "Where is this month's money going?", slash: "/month" },
  { text: "What needs me this month?" },
];

/**
 * One bar to ask, go to a screen, or do something. Typing filters screens and actions; text that
 * matches none of them is a question for the assistant. / commands and screens never wait on the
 * model, so they keep working when the assistant is off or unavailable.
 */
export function AskBar({
  entity,
  month,
  actions,
  ask,
  go,
  close,
}: {
  entity: Entity;
  month: string;
  /** Screens and workspace actions, in the order they are listed. */
  actions: Action[];
  /** Sends a question to the assistant panel. */
  ask: (text: string) => void;
  go: (to: "home" | "review") => void;
  close: () => void;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [card, setCard] = useState<Card | null>(null);
  // Whether questions can go anywhere; until this answers, Ask rows show as usual.
  const [assistant, setAssistant] = useState(true);
  useEffect(() => {
    let live = true;
    agent.settings(entity.id).then(
      (s) => live && setAssistant(s.enabled),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [entity.id]);
  const review = useLoad(() => monthly.review(entity.id, `${month}-01`), [entity.id, month], {
    enabled: card !== null,
    share: `review:${month}-01`,
  });

  const commands: Row[] = useMemo(
    () => [...CARDS, ...actions.map((a): Row => ({ kind: "action", ...a }))],
    [actions],
  );
  const rows = useMemo((): Row[] => {
    const q = query.trim();
    if (!q) return commands;
    if (q.startsWith("/")) {
      const word = q.split(/\s+/)[0].toLowerCase();
      return commands.filter((r) => "slash" in r && r.slash?.startsWith(word));
    }
    const words = q.toLowerCase().split(/\s+/);
    const fits = (text: string) => words.every((w) => text.toLowerCase().includes(w));
    const phrases: Row[] = assistant
      ? SUGGESTED.filter((s) => !s.slash && fits(s.text)).map((s) => ({
          kind: "ask",
          text: s.text,
          hint: "Ask",
        }))
      : [];
    const found = [...phrases, ...commands.filter((r) => fits(r.text))];
    if (!assistant) return found;
    const free: Row = { kind: "ask", text: q, hint: "Ask the assistant" };
    // A screen or command that matches wins Enter; otherwise the text is a question.
    return found.length ? [...found, free] : [free];
  }, [query, commands, assistant]);
  const at = Math.min(selected, rows.length - 1);

  const run = (row: Row) => {
    if (row.kind === "card") {
      setQuery("");
      setCard(row.card);
      return;
    }
    close();
    if (row.kind === "ask") ask(row.text);
    else row.run();
  };
  const tap = (phrase: (typeof SUGGESTED)[number]) => {
    const command = commands.find((r) => "slash" in r && r.slash === phrase.slash);
    if (command) run(command);
    else run({ kind: "ask", text: phrase.text, hint: "Ask" });
  };
  const name = monthName(month);
  const result = review.kind === "ready" && review.data?.review ? review.data : null;

  return (
    <Dialog title="Ask or jump" className="pal ask" onClose={close}>
      <input
        // biome-ignore lint/a11y/noAutofocus: The bar exists to take typing at once.
        autoFocus
        placeholder={assistant ? "Ask, jump to a screen, or type /" : "Jump to a screen or type /"}
        aria-label="Ask or jump"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setSelected(0);
          setCard(null);
        }}
        onKeyDown={(e) => {
          if (composing(e)) return;
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setSelected(
              (at + (e.key === "ArrowDown" ? 1 : rows.length - 1)) % Math.max(1, rows.length),
            );
          } else if (e.key === "Enter" && !card && rows[at]) {
            // Without this, the same key press lands on whatever opens next.
            e.preventDefault();
            run(rows[at]);
          }
        }}
      />
      {card ? (
        <div className="ask-card">
          <div className="ask-card-h">
            <button type="button" className="btn sm quiet" onClick={() => setCard(null)}>
              <Icon name="left" /> All commands
            </button>
            <span className="note">{fmtMonth(month)}</span>
            <span className="spacer" />
            <button
              type="button"
              className="btn sm"
              onClick={() => {
                close();
                go(card === "left" ? "home" : "review");
              }}
            >
              Open {card === "left" ? "Home" : "Review"}
            </button>
          </div>
          {review.kind === "loading" ? (
            <div className="card pad sk-card" aria-busy="true" aria-label="Loading this month">
              <div className="sk" style={{ width: "55%", height: 28 }} />
              <div className="sk" style={{ height: 8 }} />
            </div>
          ) : result?.comparison ? (
            card === "left" ? (
              <Hero
                month={month}
                today={entity.today}
                spending={result.comparison.spending}
                difference={result.spending_difference}
              />
            ) : (
              <MonthBreakdown
                comparison={result.comparison}
                name={name}
                ended={month < entity.today.slice(0, 7)}
              />
            )
          ) : review.kind === "ready" || review.kind === "empty" || review.kind === "not_found" ? (
            <p className="pal-none">
              {name} has no Review yet. Open Review to compare the month against a saved Plan
              version.
            </p>
          ) : (
            <div className="card pad">
              <LoadMessage state={review} retry={() => setCard(card)} />
            </div>
          )}
        </div>
      ) : (
        <>
          {!query && (
            <div className="ask-suggested" aria-label="Suggested">
              {SUGGESTED.filter((s) => s.slash || assistant).map((s) => (
                <button key={s.text} type="button" className="ask-chip" onClick={() => tap(s)}>
                  <Icon name={s.slash ? "right" : "chat"} />
                  {s.text}
                </button>
              ))}
            </div>
          )}
          <output className="sr-only">
            {rows[at] ? `${rows[at].text}, ${at + 1} of ${rows.length}` : "No matching commands"}
          </output>
          {rows.length ? (
            <div className="pal-list">
              {rows.map((r, i) => (
                <button
                  type="button"
                  key={`${r.kind}-${r.text}`}
                  aria-current={i === at ? "true" : undefined}
                  onClick={() => run(r)}
                  ref={i === at ? (el) => el?.scrollIntoView?.({ block: "nearest" }) : undefined}
                >
                  {r.kind === "ask" && <Icon name="chat" />}
                  {r.kind === "ask" && r.hint === "Ask the assistant" ? `Ask: ${r.text}` : r.text}
                  <small>
                    {"slash" in r && r.slash ? <span className="kbd">{r.slash}</span> : r.hint}
                  </small>
                </button>
              ))}
            </div>
          ) : (
            <div className="pal-none">
              Nothing matches "{query}".{" "}
              {assistant
                ? "Try a screen name or a / command."
                : "Turn on the assistant in Settings to ask questions."}
            </div>
          )}
        </>
      )}
    </Dialog>
  );
}
