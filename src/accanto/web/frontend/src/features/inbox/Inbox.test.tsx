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
