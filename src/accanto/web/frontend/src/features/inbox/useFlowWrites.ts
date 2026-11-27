import { useEffect, useRef, useState } from "react";
import { ApiError, type BrowserSession } from "../../lib/api";
import { type Completion, type StagedTransaction, inbox, send } from "../../lib/inbox";

type Intent = {
  it: StagedTransaction;
  completion?: Completion;
  action: "record" | "skip";
  key?: string;
  state: "queued" | "sending" | "uncertain";
  reason?: string;
  signIn?: boolean;
};
type Outcome = {
  item_id: string;
  ok: boolean;
  item?: StagedTransaction;
  error?: { message: string };
};

/** Unconfirmed commands stay in this tab, never in browser storage. A sent skip's
 * batch key and item ID together identify it, including when retrying it alone. */
export function useFlowWrites(options: {
  entity: string;
  session?: BrowserSession;
  credentials: (signIn?: boolean) => Promise<BrowserSession>;
  dirty: (value: boolean) => void;
  settled: (intent: Intent, item?: StagedTransaction, rejection?: string) => void;
  drained: () => void;
}) {
  const live = useRef(options);
  live.current = options;
  const intents = useRef<Intent[]>([]);
  const [pending, setPending] = useState<Intent[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const sending = useRef(false);
  const mounted = useRef(true);
  const unseenFailure = useRef(false);
  // A one-bit receipt, not a financial draft. Mobile browsers may kill a hidden
  // tab without firing beforeunload. Its next visit must not imply all writes saved.
  const prefix = `accanto.flow-unconfirmed:${options.entity}:`;
  const [receipt] = useState(() => prefix + crypto.randomUUID());
  const [otherReceipts, setOtherReceipts] = useState<string[]>(() => {
    try {
      return Object.keys(window.localStorage).filter((k) => k.startsWith(prefix));
    } catch {
      return [];
    }
  });
  const [storageProblem, setStorageProblem] = useState(false);
  function publish() {
    if (!intents.current.length && !unseenFailure.current && live.current.session) {
      try {
        window.localStorage.removeItem(receipt);
      } catch {
        /* Leave a conservative warning. */
      }
    }
    if (!mounted.current) return;
    setPending([...intents.current]);
    live.current.dirty(intents.current.length > 0);
  }
  async function flush() {
    clearTimeout(timer.current);
    timer.current = undefined;
    if (sending.current) return;
    sending.current = true;
    try {
      for (;;) {
        const ready = intents.current.filter((i) => i.state === "queued");
        const first = ready[0];
        if (!first) break;
        // Bound keepalive bodies below the browser quota and preserve decision order.
        const batch: Intent[] = [];
        for (const i of ready) {
          if (i.action !== first.action || i.key !== first.key || batch.length === 16) break;
          batch.push(i);
        }
        const key = first.key ?? crypto.randomUUID();
        for (const i of batch) {
          i.state = "sending";
          i.key = key;
        }
        publish();
        const { entity, session, credentials } = live.current;
        const spec =
          first.action === "record"
            ? inbox.recordMany(entity, batch)
            : inbox.actMany(
                entity,
                batch.map((i) => i.it),
                "skip",
              );
        let results: Outcome[] = [];
        let unknown = "Save not confirmed. Retry to check the same write.";
        try {
          const identity = first.signIn
            ? await credentials(true)
            : (session ?? (await credentials()));
          results = (await send<{ results: Outcome[] }>(identity, spec, key, true)).results ?? [];
        } catch (error) {
          if (error instanceof Error) unknown = error.message;
          if (error instanceof ApiError && error.kind === "unauthenticated")
            for (const i of batch) i.signIn = true;
        }
        for (const i of batch) {
          const r = results.find((r) => r.item_id === i.it.id);
          if ((!r?.ok || !r.item) && !r?.error) {
            i.state = "uncertain";
            i.reason = unknown;
            continue;
          }
          intents.current = intents.current.filter((x) => x !== i);
          if (mounted.current) live.current.settled(i, r.ok ? r.item : undefined, r.error?.message);
          else if (!r.ok) unseenFailure.current = true;
        }
        publish();
      }
    } finally {
      sending.current = false;
      if (mounted.current && !intents.current.length) live.current.drained();
    }
  }
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => {
    mounted.current = true;
    const leave = () => {
      if (intents.current.length) void flushRef.current();
    };
    const hide = () => {
      if (document.visibilityState === "hidden") leave();
    };
    window.addEventListener("beforeunload", leave);
    window.addEventListener("pagehide", leave);
    document.addEventListener("visibilitychange", hide);
    return () => {
      window.removeEventListener("beforeunload", leave);
      window.removeEventListener("pagehide", leave);
      document.removeEventListener("visibilitychange", hide);
      mounted.current = false;
      leave();
    };
  }, []);
  return {
    pending,
    storageProblem,
    otherReceipts,
    acknowledge() {
      for (const key of otherReceipts) window.localStorage.removeItem(key);
      setOtherReceipts([]);
    },
    flush,
    enqueue(it: StagedTransaction, action: Intent["action"], completion?: Completion) {
      if (intents.current.some((i) => i.it.id === it.id)) return false;
      if (live.current.session) {
        try {
          window.localStorage.setItem(receipt, "1");
          setStorageProblem(false);
        } catch {
          setStorageProblem(true);
          return false;
        }
      }
      intents.current.push({ it, action, completion, state: "queued" });
      publish();
      if (!timer.current) timer.current = setTimeout(() => void flushRef.current(), 500);
      return true;
    },
    cancel(id: string) {
      const i = intents.current.find((i) => i.it.id === id);
      if (!i || i.state !== "queued" || i.key) return false;
      intents.current = intents.current.filter((x) => x !== i);
      publish();
      return true;
    },
    retry(id: string) {
      const i = intents.current.find((i) => i.it.id === id);
      if (i?.state === "uncertain") {
        i.state = "queued";
        void flush();
      }
    },
  };
}
