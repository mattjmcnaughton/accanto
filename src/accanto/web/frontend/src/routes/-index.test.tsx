import { render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { ProductionHome } from "./index";

afterEach(() => vi.restoreAllMocks());

test("shows a clear, accessible entry state without opening browser-local financial data", () => {
  const read = vi.spyOn(Storage.prototype, "getItem");
  const write = vi.spyOn(Storage.prototype, "setItem");
  const remove = vi.spyOn(Storage.prototype, "removeItem");
  const clear = vi.spyOn(Storage.prototype, "clear");

  render(<ProductionHome />);

  expect(screen.getByRole("banner")).toBeDefined();
  expect(screen.getByRole("main")).toBeDefined();
  expect(screen.getByRole("status")).toBeDefined();
  expect(screen.getByRole("heading", { level: 1, name: "Your financial workspace" })).toBeDefined();
  expect(screen.getByText(/checking sign-in/i)).toBeDefined();
  expect(read).not.toHaveBeenCalled();
  expect(write).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();
  expect(clear).not.toHaveBeenCalled();
});
