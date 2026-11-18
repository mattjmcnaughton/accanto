import { useState } from "react";
import { cleanup, createEvent, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useGridKeys } from "./useGridKeys";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function Grid() {
  const keys = useGridKeys();
  const [position, move] = useState({ row: 1, col: 2 });
  const [editing, edit] = useState(false);
  const [removed, remove] = useState(false);
  const [requested, request] = useState<string[]>([]);
  return (
    <div>
      {/* biome-ignore lint/a11y/useSemanticElements: Interactive worksheet uses the ARIA grid pattern on a native table. */}
      <table
        role="grid"
        aria-label="Test worksheet"
        onKeyDown={(event) =>
          keys(event, {
            rowId: String(position.row),
            position,
            rows: 4,
            columns: 3,
            move,
            edit: () => edit(true),
            remove: () => remove(true),
            add: () => request((all) => [...all, "add"]),
            help: () => request((all) => [...all, "help"]),
          })
        }
      >
        <tbody>
          <tr>
            {/* biome-ignore lint/a11y/useSemanticElements: Focusable cell belongs to the interactive grid. */}
            {/* biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: Grid cells deliberately receive keyboard focus. */}
            <td role="gridcell" tabIndex={0}>
              {position.row}:{position.col}
              {editing && <input aria-label="Value" />}
            </td>
          </tr>
        </tbody>
      </table>
      <button type="button" onClick={() => move({ row: 3, col: 0 })}>
        Select last row
      </button>
      {removed && <p>Remove requested</p>}
      {requested.length > 0 && <p>Requested: {requested.join(",")}</p>}
    </div>
  );
}

it("navigates asymmetric bounds and leaves native input keys untouched", () => {
  render(<Grid />);
  const cell = screen.getByRole("gridcell");
  const key = (key: string) => fireEvent.keyDown(cell, { key });
  key("j");
  key("h");
  expect(cell.textContent).toBe("2:1");
  key("G");
  key("$");
  key("j");
  key("l");
  expect(cell.textContent).toBe("3:2");
  key("g");
  key("g");
  key("0");
  key("k");
  key("h");
  expect(cell.textContent).toBe("0:0");
  key("i");
  const input = screen.getByRole("textbox");
  for (const key of ["j", "G", "d", "d"]) fireEvent.keyDown(input, { key });
  expect(cell.textContent).toBe("0:0");
  expect(screen.queryByText("Remove requested")).toBeNull();
});

it("requires two deliberate delete presses on the same row", () => {
  render(<Grid />);
  const cell = screen.getByRole("gridcell");
  fireEvent.keyDown(cell, { key: "d" });
  fireEvent.keyDown(cell, { key: "d", repeat: true });
  expect(screen.queryByText("Remove requested")).toBeNull();
  fireEvent.keyDown(cell, { key: "d" });
  fireEvent.keyDown(cell, { key: "j" });
  fireEvent.keyDown(cell, { key: "d" });
  expect(screen.queryByText("Remove requested")).toBeNull();
  fireEvent.keyDown(cell, { key: "d" });
  expect(screen.getByText("Remove requested")).toBeTruthy();
});

it("does not delete when focus moved to another row between the two presses", () => {
  render(<Grid />);
  const cell = screen.getByRole("gridcell");
  fireEvent.keyDown(cell, { key: "d" });
  fireEvent.click(screen.getByRole("button", { name: "Select last row" }));
  fireEvent.keyDown(cell, { key: "d" });
  expect(screen.queryByText("Remove requested")).toBeNull();
  fireEvent.keyDown(cell, { key: "d" });
  expect(screen.getByText("Remove requested")).toBeTruthy();
});

it("lets a delete sequence expire after 700 ms", () => {
  vi.useFakeTimers();
  render(<Grid />);
  const cell = screen.getByRole("gridcell");
  fireEvent.keyDown(cell, { key: "d" });
  vi.advanceTimersByTime(701);
  fireEvent.keyDown(cell, { key: "d" });
  expect(screen.queryByText("Remove requested")).toBeNull();
  vi.advanceTimersByTime(699);
  fireEvent.keyDown(cell, { key: "d" });
  expect(screen.getByText("Remove requested")).toBeTruthy();
});

it("ignores modified and already handled keys but runs Enter, a, A and ? once", () => {
  render(<Grid />);
  const cell = screen.getByRole("gridcell");
  for (const init of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
    fireEvent.keyDown(cell, { key: "j", ...init });
    fireEvent.keyDown(cell, { key: "Enter", ...init });
    fireEvent.keyDown(cell, { key: "a", ...init });
  }
  const handled = createEvent.keyDown(cell, { key: "j" });
  handled.preventDefault();
  fireEvent(cell, handled);
  expect(cell.textContent).toBe("1:2");
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.queryByText(/Requested/)).toBeNull();
  fireEvent.keyDown(cell, { key: "a" });
  fireEvent.keyDown(cell, { key: "A", repeat: true });
  fireEvent.keyDown(cell, { key: "A" });
  fireEvent.keyDown(cell, { key: "?" });
  expect(screen.getByText("Requested: add,add,help")).toBeTruthy();
  fireEvent.keyDown(cell, { key: "Enter" });
  expect(screen.getByRole("textbox")).toBeTruthy();
});
