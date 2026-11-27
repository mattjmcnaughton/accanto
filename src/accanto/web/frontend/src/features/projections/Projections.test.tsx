import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as mocks from "../../stories/mocks/projections";
import type { ScreenProps } from "../workspace/shared";
import { Projections } from "./Projections";

const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });
const props = (): ScreenProps => ({
  entity: { id: "entity", name: "Synthetic Entity", today: "2026-11-10", time_zone: "UTC" },
  concealed: false,
  busy: false,
  refresh: 0,
  guard: () => true,
  dirty: vi.fn(),
  save: vi.fn(),
});
const mock = () =>
  vi.spyOn(globalThis, "fetch").mockImplementation(async (path) => {
    const url = new URL(String(path), "http://test");
    if (url.pathname.endsWith("/fire-assumptions")) return json(mocks.fireAssumptions);
    const key = `${url.searchParams.get("years")}:${url.searchParams.get("dollars")}`;
    return json(mocks.projections[key]);
  });

// This jsdom has no localStorage.
let stored: Map<string, string>;
beforeEach(() => {
  stored = new Map();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => stored.get(k) ?? null,
      setItem: (k: string, v: string) => void stored.set(k, String(v)),
    },
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("reads today's dollars by default and remembers future dollars", async () => {
  const fetch = mock();
  render(<Projections {...props()} />);
  expect(await screen.findByText("$141,639.73")).toBeTruthy();
  // The dollars explainer starts collapsed; its example uses the Entity's 3% over 20 years.
  const explainer = screen.getByText(/Explainer: today's vs future dollars/).closest("details");
  expect(explainer?.open).toBe(false);
  expect(explainer?.textContent).toContain("$100,000.00 in 20 years ≈ $55,367.58 today");
  fireEvent.click(screen.getByRole("button", { name: "Future dollars" }));
  // The 5-year net worth in nominal dollars, before inflation.
  expect(await screen.findByText("$164,199.27")).toBeTruthy();
  expect(fetch.mock.calls.map(([path]) => String(path))).toContain(
    "/api/entities/entity/projections?years=20&dollars=future",
  );
  expect(stored.get("accanto.projection-dollars")).toBe("future");
});

it("saves the full list of fixed costs held level with the FIRE assumptions", async () => {
  mock();
  const p = props();
  render(<Projections {...p} />);
  fireEvent.click(
    await screen.findByRole("button", { name: /Fixed costs that do not rise with inflation/ }),
  );
  // The education payment starts held level; add rent, so both are listed.
  fireEvent.click(screen.getByRole("checkbox", { name: /Rent/ }));
  fireEvent.click(screen.getByRole("button", { name: "Save assumptions" }));
  await waitFor(() => expect(p.save).toHaveBeenCalled());
  const spec = vi.mocked(p.save).mock.calls[0][0] as { body: Record<string, unknown> };
  expect(spec.body.fixed_costs_not_rising_with_inflation).toEqual([
    "83c54cf3-ce22-43f0-8050-d3e8aae97138",
    "6e8226b8-189a-433f-b49b-37865af43cf5",
  ]);
  expect(spec.body.inflation_percent).toBe("3.00");
});
