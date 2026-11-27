import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProductionHome } from "../../routes/__root";

// Two invented Entities of one synthetic User.
const FAMILY = "11111111-1111-4111-8111-111111111111";
const PERSONAL = "22222222-2222-4222-8222-222222222222";
const session = {
  user: { id: "u" },
  csrf_token: "test",
  entities: [
    { id: FAMILY, name: "Synthetic Family", today: "2026-10-17", time_zone: "UTC" },
    {
      id: PERSONAL,
      name: "Synthetic Personal",
      today: "2026-11-02",
      time_zone: "UTC",
      role: "member",
    },
  ],
};

// This jsdom has no localStorage, and no scrollTo for the assistant's transcript.
let stored: Map<string, string>;
beforeEach(() => {
  stored = new Map();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => stored.get(k) ?? null,
      setItem: (k: string, v: string) => void stored.set(k, String(v)),
      removeItem: (k: string) => void stored.delete(k),
      clear: () => stored.clear(),
    },
  });
  HTMLElement.prototype.scrollTo = () => {};
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function serve(write: (path: string) => Promise<Response> = () => new Promise(() => {})) {
  const reads: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const path = String(input);
    if (init?.method && init.method !== "GET") return write(path);
    reads.push(path);
    if (path === "/api/auth/session") return new Response(JSON.stringify(session));
    if (path.endsWith("/agent/settings"))
      return new Response(
        JSON.stringify({
          enabled: true,
          mode: "ask_first",
          instructions: "",
          revision: 1,
          provider: "stub",
          retention_days: 30,
          daily_message_cap: 200,
        }),
      );
    return new Response("[]");
  });
  return reads;
}

it("opens the last-used Entity, switches to another on its own month and remembers only its ID", async () => {
  window.localStorage.setItem("accanto.entity", PERSONAL);
  const reads = serve();
  render(<ProductionHome />);
  const picker = await screen.findByRole("combobox", { name: "Entity" });
  expect((picker as HTMLSelectElement).value).toBe(PERSONAL);
  expect(within(screen.getByRole("banner")).getByText("November 2026")).toBeDefined();
  await waitFor(() => expect(reads).toContain(`/api/entities/${PERSONAL}/plans`));

  fireEvent.change(picker, { target: { value: FAMILY } });
  const top = screen.getByRole("banner");
  await waitFor(() => expect(within(top).getByText("October 2026")).toBeDefined());
  expect((screen.getByRole("combobox", { name: "Entity" }) as HTMLSelectElement).value).toBe(
    FAMILY,
  );
  await waitFor(() => expect(reads).toContain(`/api/entities/${FAMILY}/plans`));
  expect(window.localStorage.getItem("accanto.entity")).toBe(FAMILY);
  expect([...stored.keys()]).toEqual(["accanto.entity"]);
});

it("switches from the Entity named in the top bar, marking the current and shared ones", async () => {
  const reads = serve();
  render(<ProductionHome />);
  fireEvent.click(await screen.findByRole("button", { name: "Entity: Synthetic Family" }));
  const list = screen.getByRole("dialog", { name: "Switch Entity" });
  expect(
    within(list).getByRole("button", { name: "Synthetic Family" }).getAttribute("aria-current"),
  ).toBe("true");
  const shared = within(list).getByRole("button", { name: /Synthetic Personal/ });
  expect(shared.textContent).toContain("Shared with you");
  expect(shared.getAttribute("aria-current")).toBeNull();
  fireEvent.click(shared);
  await waitFor(() =>
    expect(
      within(screen.getByRole("banner")).getByRole("button", {
        name: "Entity: Synthetic Personal",
      }),
    ).toBeDefined(),
  );
  expect(screen.queryByRole("dialog", { name: "Switch Entity" })).toBeNull();
  await waitFor(() => expect(reads).toContain(`/api/entities/${PERSONAL}/plans`));
});

it("offers the other Entities and Create Entity in the command palette", async () => {
  serve();
  render(<ProductionHome />);
  await screen.findByRole("combobox", { name: "Entity" });
  fireEvent.keyDown(document, { key: "k", ctrlKey: true });
  const palette = screen.getByRole("dialog", { name: "Ask or jump" });
  expect(
    within(palette).getByRole("button", { name: /Switch to Synthetic Personal/ }),
  ).toBeDefined();
  expect(within(palette).queryByRole("button", { name: /Switch to Synthetic Family/ })).toBeNull();
  fireEvent.click(within(palette).getByRole("button", { name: /Create Entity/ }));
  const dialog = screen.getByRole("dialog", { name: "Create Entity" });
  expect((within(dialog).getByLabelText(/^Time zone/) as HTMLInputElement).value).toBe("UTC");
});

it("asks before discarding a pending write and stays put when declined", async () => {
  serve();
  render(<ProductionHome />);
  fireEvent.click(await screen.findByRole("button", { name: "Create your first Plan" }));
  fireEvent.change(screen.getByLabelText("Plan name"), { target: { value: "Unsaved Plan" } });
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  fireEvent.change(screen.getByRole("combobox", { name: "Entity" }), {
    target: { value: PERSONAL },
  });
  expect(confirm).toHaveBeenCalled();
  expect((screen.getByRole("combobox", { name: "Entity" }) as HTMLSelectElement).value).toBe(
    FAMILY,
  );
  expect(screen.getByDisplayValue("Unsaved Plan")).toBeDefined();
});

it("blocks switching while an assistant reply streams, and names the Entity in the panel", async () => {
  serve();
  render(<ProductionHome />);
  await screen.findByRole("combobox", { name: "Entity" });
  fireEvent.click(within(screen.getByRole("banner")).getByRole("button", { name: "Assistant" }));
  const panel = screen.getByRole("complementary", { name: "Assistant" });
  expect(within(panel).getByText("Synthetic Family")).toBeDefined();
  const box = await within(panel).findByLabelText("Message the assistant");
  fireEvent.change(box, { target: { value: "Hello" } });
  fireEvent.click(within(panel).getByRole("button", { name: "Send" }));
  await within(panel).findByRole("button", { name: "Stop" });
  fireEvent.change(screen.getByRole("combobox", { name: "Entity" }), {
    target: { value: PERSONAL },
  });
  expect(await screen.findByText(/Wait for the assistant's reply/)).toBeDefined();
  expect((screen.getByRole("combobox", { name: "Entity" }) as HTMLSelectElement).value).toBe(
    FAMILY,
  );
});
