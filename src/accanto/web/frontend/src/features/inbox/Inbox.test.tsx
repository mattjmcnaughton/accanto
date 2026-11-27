import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { type Proposal, type StagedTransaction, inbox } from "../../lib/inbox";
import type { Activity } from "../../lib/monthly";
import { Inbox } from "./Inbox";
import { precheck, refundCandidates } from "./inboxModel";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const session = {
  user: { id: "u" },
  csrf_token: "csrf-synthetic",
  entities: [{ id: "e", name: "Synthetic Entity", today: "2026-11-20", time_zone: "UTC" }],
};
const item = (over: Partial<StagedTransaction>): StagedTransaction => ({
  id: "i1",
  source_id: "s",
  source_ref: "tx-1",
  parent_ref: null,
  split: null,
  account_ref: "a",
  account_name: "Example Checking",
  financial_date: "2026-11-09",
  amount: "-12.00",
  payee: "Example Coffee Cart",
  source_category: { id: "c", name: "Dining Out" },
  memo: null,
  kind: "ordinary",
  cleared: true,
  approved: true,
  deleted_in_source: false,
  status: "waiting",
  actual_entry_id: null,
  rejection: null,
  changed_after_staging: false,
  proposal: null,
  proposal_rejection: null,
  proposed_by: null,
  staged_at: "2026-11-20T00:00:00Z",
  revision: 3,
  ...over,
});
const purchase = (uuid: string, date: string, note: string, left: string) =>
  ({
    uuid,
    financial_date: date,
    category: "spending",
    amount: "90.00",
    note,
    remaining_refundable: left,
  }) as Activity;

it("explains an inflow to an outflow category as a refund before any request", () => {
  const inflow = item({ amount: "48.00", payee: "Example Outfitters" });
  expect(precheck(inflow, { category: "spending" })).toMatch(/is a refund/);
  expect(precheck(inflow, { refund_of: "p" })).toBeNull();
  expect(precheck(item({}), { category: "fixed_cost" })).toMatch(/fixed cost/);
  expect(precheck(item({}), { category: "income", assignment: "x" })).toMatch(/outflow/);
});

it("ranks refund candidates by payee, then the nearest earlier date, with enough left", () => {
  const inflow = item({ amount: "48.00", payee: "Example Outfitters" });
  const ranked = refundCandidates(inflow, [
    purchase("other-recent", "2026-11-08", "Sample Shoe Shop", "90.00"),
    purchase("same-old", "2026-10-18", "Example Outfitters", "90.00"),
    purchase("same-new", "2026-11-03", "Example Outfitters", "90.00"),
    purchase("too-little", "2026-11-04", "Example Outfitters", "47.99"),
    purchase("later", "2026-11-10", "Example Outfitters", "90.00"),
  ]);
  expect(ranked.map((o) => o.id)).toEqual(["same-new", "same-old", "other-recent"]);
});

it("records with Enter, keeps 1–6 inside the inbox, and sends the item's revision", async () => {
  const writes: Array<{ path: string; body: unknown; headers: Headers }> = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (path, init) => {
    const url = String(path);
    if (init?.method === "POST") {
      writes.push({
        path: url,
        body: JSON.parse(String(init.body)),
        headers: new Headers(init.headers),
      });
      return new Response(JSON.stringify({ item: {}, entry: {} }));
    }
    if (url.endsWith("/inbox")) return new Response(JSON.stringify([item({})]));
    return new Response("[]");
  });
  const workspaceKeys = vi.fn();
  document.addEventListener("keydown", (e) => !e.defaultPrevented && workspaceKeys(e.key));
  render(
    <Inbox
      entity={session.entities[0]}
      concealed={false}
      busy={false}
      refresh={0}
      guard={() => true}
      dirty={() => {}}
      save={() => {}}
      credentials={async () => session}
    />,
  );
  await screen.findByText("Example Coffee Cart", { selector: ".ix-d-t" });
  fireEvent.keyDown(document.body, { key: "Enter" });
  expect(
    await screen.findByText(/There is no proposal to accept/, { selector: ".ix-msg" }),
  ).toBeDefined();
  expect(writes).toEqual([]);
  fireEvent.keyDown(document.body, { key: "3" });
  expect(workspaceKeys).not.toHaveBeenCalledWith("3");
  fireEvent.keyDown(document.body, { key: "n" });
  expect(workspaceKeys).toHaveBeenCalledWith("n");
  workspaceKeys.mockClear();
  fireEvent.keyDown(document.body, { key: "f" });
  await screen.findByText(/Funding origin for Example Coffee Cart/);
  fireEvent.keyDown(document.body, { key: "n" });
  expect(workspaceKeys).not.toHaveBeenCalledWith("n");
  fireEvent.keyDown(document.body, { key: "Escape" });
  fireEvent.keyDown(document.body, { key: "Enter" });
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0].path).toBe("/api/entities/e/inbox/i1/record");
  expect(writes[0].body).toEqual({
    expected_revision: 3,
    completion: { category: "spending", assignment: null, funding: "income" },
  });
  expect(writes[0].headers.get("X-CSRF-Token")).toBe("csrf-synthetic");
  expect(
    await screen.findByText(/Recorded Example Coffee Cart as guilt-free spending/),
  ).toBeDefined();
});

it("leaves keys pressed in the assistant panel to the panel", async () => {
  const writes: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (init?.method === "POST") {
      writes.push(url);
      return new Response(JSON.stringify(item({ status: "skipped", revision: 4 })));
    }
    if (url.endsWith("/inbox")) return new Response(JSON.stringify([item({})]));
    return new Response("[]");
  });
  render(
    <>
      <Inbox
        entity={session.entities[0]}
        concealed={false}
        busy={false}
        refresh={0}
        guard={() => true}
        dirty={() => {}}
        save={() => {}}
        credentials={async () => session}
      />
      <aside data-own-keys="">
        <button type="button">Apply</button>
      </aside>
    </>,
  );
  await screen.findByText("Example Coffee Cart", { selector: ".ix-d-t" });
  const apply = screen.getByRole("button", { name: "Apply" });
  fireEvent.keyDown(apply, { key: "s" });
  fireEvent.keyDown(apply, { key: "3" });
  await new Promise((r) => setTimeout(r, 20));
  expect(writes).toEqual([]);
  // The same key on the page itself still skips: only the panel's keys are left alone.
  fireEvent.keyDown(document.body, { key: "s" });
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0]).toMatch(/\/inbox\/i1\/skip$/);
});

it("sends only completion fields when a draft was copied from a proposal", () => {
  const draft: Proposal = { category: "spending", funding: "income", rationale: "Synthetic" };
  const write = inbox.record("e", item({}), { ...draft, funding: "goal-1" });
  expect(write.body).toEqual({
    expected_revision: 3,
    completion: { category: "spending", funding: "goal-1" },
  });
});

it("adds tags with t and records them with the item", async () => {
  const writes: Array<{ path: string; body: unknown }> = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (path, init) => {
    const url = String(path);
    if (init?.method === "POST") {
      writes.push({ path: url, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ item: {}, entry: {} }));
    }
    if (url.endsWith("/inbox")) return new Response(JSON.stringify([item({})]));
    if (url.endsWith("/tags"))
      return new Response(
        JSON.stringify([
          { uuid: "tag-trip", name: "Italy trip", active: true, revision: 1, entries: 0 },
          { uuid: "tag-old", name: "Old project", active: false, revision: 2, entries: 4 },
        ]),
      );
    return new Response("[]");
  });
  render(
    <Inbox
      entity={session.entities[0]}
      concealed={false}
      busy={false}
      refresh={0}
      guard={() => true}
      dirty={() => {}}
      save={() => {}}
      credentials={async () => session}
    />,
  );
  await screen.findByText("Example Coffee Cart", { selector: ".ix-d-t" });
  fireEvent.keyDown(document.body, { key: "3" });
  fireEvent.keyDown(document.body, { key: "t" });
  await screen.findByText(/Tags for Example Coffee Cart/);
  // Archived tags cannot be added.
  expect(screen.queryByText("Old project")).toBeNull();
  fireEvent.click(screen.getByText("Italy trip"));
  expect(await screen.findByText("Italy trip", { selector: ".fv" })).toBeDefined();
  fireEvent.keyDown(document.body, { key: "Enter" });
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0].body).toEqual({
    expected_revision: 3,
    completion: {
      category: "spending",
      assignment: null,
      funding: "income",
      tag_ids: ["tag-trip"],
    },
  });
});

it("assigns guilt-free spending to a subcategory with a, and records Unassigned without one", async () => {
  const writes: Array<{ path: string; body: unknown }> = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (path, init) => {
    const url = String(path);
    if (init?.method === "POST") {
      writes.push({ path: url, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ item: {}, entry: {} }));
    }
    if (url.endsWith("/inbox")) return new Response(JSON.stringify([item({})]));
    if (url.endsWith("/spending-subcategories"))
      return new Response(
        JSON.stringify([
          { uuid: "sub-eat", name: "Eating out", active: true, revision: 1, entries: 0 },
          { uuid: "sub-old", name: "Old hobby", active: false, revision: 2, entries: 4 },
        ]),
      );
    return new Response("[]");
  });
  render(
    <Inbox
      entity={session.entities[0]}
      concealed={false}
      busy={false}
      refresh={0}
      guard={() => true}
      dirty={() => {}}
      save={() => {}}
      credentials={async () => session}
    />,
  );
  await screen.findByText("Example Coffee Cart", { selector: ".ix-d-t" });
  fireEvent.keyDown(document.body, { key: "3" });
  // Optional: choosing guilt-free spending does not demand a subcategory.
  expect(screen.queryByText(/Subcategory for Example Coffee Cart/)).toBeNull();
  expect(await screen.findByText("Unassigned", { selector: ".fv" })).toBeDefined();
  fireEvent.keyDown(document.body, { key: "a" });
  await screen.findByText(/Subcategory for Example Coffee Cart/);
  expect(screen.queryByText("Old hobby")).toBeNull();
  fireEvent.click(screen.getByText("Eating out"));
  expect(await screen.findByText("Eating out", { selector: ".fv" })).toBeDefined();
  fireEvent.keyDown(document.body, { key: "Enter" });
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0].body).toMatchObject({
    completion: { category: "spending", assignment: "sub-eat", funding: "income" },
  });
});

it("filters to items with a proposal with p, keeping the Review's waiting count", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (path) => {
    if (String(path).endsWith("/inbox"))
      return new Response(
        JSON.stringify([
          item({}),
          item({
            id: "i2",
            source_ref: "tx-2",
            payee: "Sample Hardware",
            proposal: { category: "spending", rationale: "Synthetic" },
            proposed_by: { user_id: "u", interface: "mcp", at: "2026-11-20T00:00:00Z" },
          }),
          item({ id: "i3", source_ref: "tx-3", payee: "Example Bakery", status: "skipped" }),
        ]),
      );
    return new Response("[]");
  });
  render(
    <Inbox
      entity={session.entities[0]}
      concealed={false}
      busy={false}
      refresh={0}
      guard={() => true}
      dirty={() => {}}
      save={() => {}}
      credentials={async () => session}
    />,
  );
  await screen.findByText("Example Coffee Cart", { selector: ".ix-d-t" });
  const waiting = () => screen.getByRole("button", { name: /^Waiting/ }).textContent;
  expect(waiting()).toBe("Waiting 2");
  fireEvent.keyDown(document.body, { key: "p" });
  await waitFor(() => expect(waiting()).toBe("Waiting 1"));
  expect(screen.getByRole("button", { name: "With proposals" }).getAttribute("aria-pressed")).toBe(
    "true",
  );
  expect(screen.queryByText("Example Coffee Cart", { selector: ".ix-row *" })).toBeNull();
  expect(screen.getByText("Sample Hardware", { selector: ".ix-d-t" })).toBeDefined();
  expect(screen.getByRole("button", { name: /^Ignored/ }).textContent).toBe("Ignored 0");
  // The strip mirrors the month's Review, so it still counts every waiting item.
  expect(document.querySelector(".ix-strip")?.textContent).toContain(
    "2 transactions waiting in the inbox",
  );
  fireEvent.click(screen.getByRole("button", { name: "All" }));
  await waitFor(() => expect(waiting()).toBe("Waiting 2"));
});

it("searches every field as you type, inside the views and filters, and X selects only matches", async () => {
  const unsure = { rationale: "Is this a gift for the office party?" } as unknown as Proposal;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (path) => {
    if (String(path).endsWith("/inbox"))
      return new Response(
        JSON.stringify([
          item({ memo: "Oat latte" }),
          item({
            id: "i2",
            source_ref: "tx-2",
            payee: "Sample Hardware",
            amount: "-1234.50",
            proposal: { category: "spending", rationale: "Synthetic" },
          }),
          item({ id: "i3", source_ref: "tx-3", payee: "Example Bakery", proposal: unsure }),
          item({ id: "i4", source_ref: "tx-4", payee: "Example Bakery", status: "skipped" }),
        ]),
      );
    return new Response("[]");
  });
  render(
    <Inbox
      entity={session.entities[0]}
      concealed={false}
      busy={false}
      refresh={0}
      guard={() => true}
      dirty={() => {}}
      save={() => {}}
      credentials={async () => session}
    />,
  );
  await screen.findByText("Example Coffee Cart", { selector: ".ix-d-t" });
  const input = screen.getByRole("searchbox", { name: "Search the inbox" }) as HTMLInputElement;
  fireEvent.keyDown(document.body, { key: "/" });
  expect(document.activeElement).toBe(input);
  const rows = () =>
    screen.queryAllByRole("option").map((o) => o.querySelector(".tt span")?.textContent);
  const count = (view: string) => screen.getByRole("button", { name: new RegExp(`^${view}`) });
  const search = (value: string) => fireEvent.change(input, { target: { value } });

  search("latte"); // memo
  expect(rows()).toEqual(["Example Coffee Cart"]);
  search("$1,234.5"); // amount as typed, with "$" and a thousands separator
  expect(rows()).toEqual(["Sample Hardware"]);
  search("guilt-free"); // the proposal's category
  expect(rows()).toEqual(["Sample Hardware"]);
  search("party office"); // the agent's question; every word, in any order
  expect(rows()).toEqual(["Example Bakery"]);
  search("dining -12"); // source category and signed amount
  expect(rows()).toEqual(["Example Coffee Cart", "Example Bakery"]);

  // The view counts follow the search, and Select all takes only the matching rows.
  search("example");
  expect(count("Waiting").textContent).toBe("Waiting 2");
  expect(count("Ignored").textContent).toBe("Ignored 1");
  fireEvent.keyDown(document.body, { key: "X" });
  expect(await screen.findByText("2 selected", { selector: ".ix-d-t" })).toBeDefined();
  expect(screen.getByRole("checkbox", { name: /^Select all 2/ })).toBeDefined();
  // With the proposals filter as well, only the bakery item is left.
  fireEvent.keyDown(document.body, { key: "p" });
  await waitFor(() => expect(rows()).toEqual(["Example Bakery"]));
  // The coffee cart matches the search but has no proposal.
  search("latte");
  expect(screen.getByText(/Nothing waiting matches “latte”/)).toBeDefined();
  fireEvent.keyDown(input, { key: "Escape" });
  expect(input.value).toBe("");
});

it("searches a recorded item by its entry's subcategory and tags, and a proposal by its tags", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (path) => {
    const url = String(path);
    if (url.endsWith("/inbox"))
      return new Response(
        JSON.stringify([
          item({ status: "recorded", actual_entry_id: "entry-1" }),
          item({
            id: "i2",
            source_ref: "tx-2",
            payee: "Sample Market",
            proposal: { category: "spending", tag_ids: ["tag-kids"] } as unknown as Proposal,
          }),
        ]),
      );
    if (url.endsWith("/activity"))
      return new Response(
        JSON.stringify([
          {
            uuid: "entry-1",
            financial_date: "2026-11-09",
            category: "spending",
            amount: "12.00",
            note: "Example Coffee Cart",
            spending_subcategory_id: "sub-eat",
            spending_subcategory_name: "Eating out",
            tag_ids: ["tag-trip"],
          },
        ]),
      );
    if (url.endsWith("/tags"))
      return new Response(
        JSON.stringify([
          { uuid: "tag-trip", name: "Italy trip", active: true, revision: 1, entries: 1 },
          { uuid: "tag-kids", name: "Kids", active: true, revision: 1, entries: 0 },
        ]),
      );
    return new Response("[]");
  });
  render(
    <Inbox
      entity={session.entities[0]}
      concealed={false}
      busy={false}
      refresh={0}
      guard={() => true}
      dirty={() => {}}
      save={() => {}}
      credentials={async () => session}
    />,
  );
  await screen.findByText("Sample Market", { selector: ".ix-d-t" });
  const input = screen.getByRole("searchbox", { name: "Search the inbox" });
  const count = (view: string) =>
    screen.getByRole("button", { name: new RegExp(`^${view}`) }).textContent;
  const search = (value: string) => fireEvent.change(input, { target: { value } });
  // The recorded entry's subcategory and tag, which the row does not show.
  await waitFor(() => {
    search("eating out");
    expect(count("Recorded")).toBe("Recorded 1");
  });
  expect(count("Waiting")).toBe("Waiting 0");
  search("italy");
  expect(count("Recorded")).toBe("Recorded 1");
  // A proposal's tag.
  search("kids");
  expect(count("Waiting")).toBe("Waiting 1");
  expect(count("Recorded")).toBe("Recorded 0");
});

it("advances before sending, cancels a queued ignore, and returns only the rejected record", async () => {
  const proposal = (category: Proposal["category"], rationale: string) =>
    ({ category, rationale, skip: false, tag_ids: [] }) as unknown as Proposal;
  const a = item({
    id: "a",
    payee: "Example Coffee Cart",
    proposal: proposal("spending", "Coffee."),
  });
  const b = item({
    id: "b",
    source_ref: "tx-2",
    payee: "Unknown Vendor",
    financial_date: "2026-11-10",
    proposal: proposal(null, "Not sure: no memo."),
  });
  const c = item({
    id: "c",
    source_ref: "tx-3",
    payee: "Sample Street Market",
    financial_date: "2026-11-11",
    proposal: proposal("spending", "Groceries."),
  });
  const writes: Array<{ path: string; body: object }> = [];
  let listReads = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (path, init) => {
    const url = String(path);
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      writes.push({ path: url, body });
      return new Response(
        JSON.stringify({
          results: [
            { item_id: "a", ok: true, item: { ...a, status: "recorded", revision: 4 } },
            { item_id: "c", ok: false, error: { message: "Synthetic funding limit." } },
          ],
        }),
      );
    }
    if (url.endsWith("/inbox")) {
      listReads++;
      return new Response(JSON.stringify([a, b, c]));
    }
    if (url.endsWith("/sources"))
      return new Response(
        JSON.stringify([{ id: "s", name: "Example Plan", connected: true, accounts: ["x"] }]),
      );
    return new Response("[]");
  });
  render(
    <Inbox
      entity={session.entities[0]}
      concealed={false}
      busy={false}
      refresh={0}
      guard={() => true}
      dirty={() => {}}
      save={() => {}}
      credentials={async () => session}
    />,
  );
  await screen.findByText("Example Coffee Cart", { selector: ".ix-d-t" });
  const reads = listReads;
  const press = (key: string) => fireEvent.keyDown(document.body, { key });
  const card = (name: string) => screen.findByRole("article", { name: new RegExp(`^${name}`) });

  press("F");
  await card("Example Coffee Cart");
  press("Enter");
  // Recorded from the proposal; the unsure item comes next.
  await card("Unknown Vendor");
  expect(writes).toHaveLength(0);
  press("Enter");
  // Unsure: Enter opens edit instead of sending anything.
  expect(await screen.findByText(/The agent was not sure/)).toBeDefined();
  expect(writes).toHaveLength(0);
  press("Escape");
  press("l");
  await card("Sample Street Market");
  press("s");
  expect(await screen.findByText("Pass complete")).toBeDefined();
  expect(screen.getByText(/2 unconfirmed · Keep/)).toBeDefined();
  press("z");
  await card("Sample Street Market");
  press("Enter");
  await screen.findByText(/Not saved. Synthetic funding limit/);
  await card("Sample Street Market");
  expect(writes).toEqual([
    {
      path: "/api/entities/e/inbox/record",
      body: {
        items: [
          { item_id: "a", expected_revision: 3 },
          { item_id: "c", expected_revision: 3 },
        ],
      },
    },
  ]);
  expect(listReads).toBe(reads);
});

it("flushes on leaving flow and retries an unconfirmed ignore with its original body and key", async () => {
  const i = item({});
  const attempts: { path: string; body: unknown; key: string | null }[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (path, init) => {
    if (init?.method === "POST") {
      attempts.push({
        path: String(path),
        body: init.body,
        key: new Headers(init.headers).get("Idempotency-Key"),
      });
      if (attempts.length === 1) throw new TypeError("offline");
      return new Response(
        JSON.stringify({
          results: [{ item_id: i.id, ok: true, item: { ...i, status: "skipped", revision: 4 } }],
        }),
      );
    }
    return new Response(JSON.stringify(String(path).endsWith("/inbox") ? [i] : []));
  });
  render(
    <Inbox
      entity={session.entities[0]}
      concealed={false}
      busy={false}
      refresh={0}
      guard={() => true}
      dirty={() => {}}
      save={() => {}}
      credentials={async () => session}
    />,
  );
  await screen.findByText(i.payee, { selector: ".ix-d-t" });
  for (const key of ["F", "s", "Escape"]) fireEvent.keyDown(document.body, { key });
  await screen.findByText(/Could not reach Accanto/);
  expect(screen.queryByRole("article")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(screen.queryByText(/unconfirmed · Keep/)).toBeNull());
  expect(attempts[0].key).toBeTruthy();
  expect(attempts[0].path).toMatch(/\/inbox\/skip$/);
  expect(attempts).toEqual([attempts[0], attempts[0]]);
  expect(screen.getByRole("button", { name: "Ignored 1" })).toBeDefined();
});

it("batch resolves a shift-click range with one choice and keeps only failures selected", async () => {
  const proposal = { category: "spending", rationale: "Synthetic" } as unknown as Proposal;
  const a = item({ id: "a", payee: "Example Software Co" });
  const b = item({ id: "b", source_ref: "tx-2", payee: "Example Software Co", revision: 5 });
  const c = item({ id: "c", source_ref: "tx-3", payee: "Sample Hardware", proposal });
  const d = item({ id: "d", source_ref: "tx-4", payee: "Example Bakery" });
  const writes: Array<{ path: string; body: { items: Array<Record<string, unknown>> } }> = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (path, init) => {
    const url = String(path);
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      writes.push({ path: url, body });
      if (url.endsWith("/inbox/record"))
        return new Response(
          JSON.stringify({
            results: [
              { item_id: "a", ok: true, item: { ...a, status: "recorded", revision: 4 } },
              {
                item_id: "b",
                ok: false,
                error: { code: "stale_revision", message: "Synthetic: changed elsewhere." },
              },
              { item_id: "c", ok: true, item: { ...c, status: "recorded", revision: 4 } },
            ],
          }),
        );
      return new Response(
        JSON.stringify({
          results: [{ item_id: "b", ok: true, item: { ...b, status: "skipped", revision: 6 } }],
        }),
      );
    }
    if (url.endsWith("/inbox")) return new Response(JSON.stringify([a, b, c, d]));
    if (url.endsWith("/spending-subcategories"))
      return new Response(
        JSON.stringify([{ uuid: "sub-tools", name: "Tools", active: true, revision: 1 }]),
      );
    return new Response("[]");
  });
  render(
    <Inbox
      entity={session.entities[0]}
      concealed={false}
      busy={false}
      refresh={0}
      guard={() => true}
      dirty={() => {}}
      save={() => {}}
      credentials={async () => session}
    />,
  );
  await screen.findByText("Example Software Co", { selector: ".ix-d-t" });
  const box = (name: RegExp) => screen.getByRole("checkbox", { name });
  fireEvent.click(screen.getAllByRole("checkbox", { name: /^Select Example Software Co/ })[0]);
  // Shift-click selects the rows between, not only the two ends; d stays out.
  fireEvent.click(box(/^Select Sample Hardware/), { shiftKey: true });
  expect(await screen.findByText("3 selected", { selector: ".ix-d-t" })).toBeDefined();
  expect(box(/^Select Example Bakery/).getAttribute("aria-checked")).toBe("false");
  expect(box(/^Select all 4/).getAttribute("aria-checked")).toBe("mixed");

  // One category and one subcategory for all three, then one request records them.
  fireEvent.keyDown(document.body, { key: "3" });
  fireEvent.keyDown(document.body, { key: "a" });
  await screen.findByText("Subcategory for 3 selected");
  fireEvent.click(screen.getByText("Tools"));
  expect(await screen.findByText("Tools", { selector: ".fv" })).toBeDefined();
  fireEvent.keyDown(document.body, { key: "Enter" });
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0].path).toBe("/api/entities/e/inbox/record");
  expect(writes[0].body.items).toEqual(
    [
      [a, { funding: "income" }],
      [b, { funding: "income" }],
      // c's proposal already had this category, so its other choices stay, as with one item.
      [c, { skip: false }],
    ].map(([it, rest]) => ({
      item_id: (it as StagedTransaction).id,
      expected_revision: (it as StagedTransaction).revision,
      completion: { category: "spending", assignment: "sub-tools", ...rest },
    })),
  );
  // The rejected item stays selected with its reason; the recorded ones leave.
  expect(await screen.findByText(/Recorded 2\. 1 stayed selected/)).toBeDefined();
  expect(
    await screen.findByText(/Synthetic: changed elsewhere/, { selector: ".ix-why-row" }),
  ).toBeDefined();
  expect(screen.getByText("1 selected", { selector: ".ix-d-t" })).toBeDefined();
  expect(screen.queryByText("Sample Hardware", { selector: ".ix-row *" })).toBeNull();

  fireEvent.keyDown(document.body, { key: "s" });
  await waitFor(() => expect(writes).toHaveLength(2));
  expect(writes[1]).toEqual({
    path: "/api/entities/e/inbox/skip",
    body: { items: [{ item_id: "b", expected_revision: 5 }] },
  });
});
