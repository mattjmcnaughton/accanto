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
  expect(await screen.findByText(/There is no proposal to accept/)).toBeDefined();
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

it("steps through a pass in flow with one request per key and no list reloads", async () => {
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
  const writes: Array<{ path: string; body: { expected_revision?: number } }> = [];
  let listReads = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (path, init) => {
    const url = String(path);
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      writes.push({ path: url, body });
      const revision = body.expected_revision + 1;
      if (url.endsWith("/a/record"))
        return new Response(JSON.stringify({ item: { ...a, status: "recorded", revision } }));
      if (url.endsWith("/c/skip"))
        return new Response(JSON.stringify({ ...c, status: "skipped", revision }));
      if (url.endsWith("/c/unskip"))
        return new Response(JSON.stringify({ ...c, status: "waiting", revision }));
      return new Response("{}", { status: 500 });
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
  expect(writes.map((w) => w.path)).toEqual(["/api/entities/e/inbox/a/record"]);
  press("Enter");
  // Unsure: Enter opens edit instead of sending anything.
  expect(await screen.findByText(/The agent was not sure/)).toBeDefined();
  expect(writes).toHaveLength(1);
  press("Escape");
  press("l");
  await card("Sample Street Market");
  press("s");
  expect(await screen.findByText("Pass complete")).toBeDefined();
  expect(screen.getByText(/1 recorded · 1 ignored · 1 left for later/)).toBeDefined();
  press("z");
  await card("Sample Street Market");
  // Undo used the revision the ignore returned (4), without reading the list again.
  expect(writes.map((w) => [w.path.split("/inbox/")[1], w.body.expected_revision])).toEqual([
    ["a/record", 3],
    ["c/skip", 3],
    ["c/unskip", 4],
  ]);
  expect(listReads).toBe(reads);
});
