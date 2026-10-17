import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { RecoveryNotice } from "./RecoveryNotice";

const actions = () => ({
  onRetry: vi.fn(),
  onSignIn: vi.fn(),
  onReconcile: vi.fn(),
  onDiscard: vi.fn(),
});

afterEach(cleanup);

test("uncertain save offers retry without claiming success", () => {
  const handlers = actions();
  render(<RecoveryNotice status="unavailable" {...handlers} />);
  expect(screen.getByRole("alert").textContent).toContain("not confirmed");
  fireEvent.click(screen.getByRole("button", { name: "Retry save" }));
  expect(handlers.onRetry).toHaveBeenCalledOnce();
});

test("wrong User sees no pending financial input or submit action", () => {
  render(<RecoveryNotice status="wrong_user" {...actions()} />);
  expect(screen.getByRole("alert").textContent).toContain("hidden");
  expect(screen.queryByRole("button", { name: "Retry save" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Discard pending save" })).toBeNull();
  expect(screen.getByRole("button", { name: "Sign in in a new window" })).toBeDefined();
});
