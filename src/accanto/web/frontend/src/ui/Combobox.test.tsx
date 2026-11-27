import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { Combobox } from "./Combobox";

afterEach(cleanup);
const options = [
  { id: "", name: "Unassigned" },
  { id: "eat", name: "Eating out" },
  { id: "books", name: "Books" },
];

function Harness(p: { onCreate: (name: string) => void; taken?: string[]; onSubmit: () => void }) {
  const [value, setValue] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        p.onSubmit();
      }}
      onKeyDown={(e) => e.key === "Escape" && p.onSubmit()}
    >
      <Combobox
        label="Subcategory"
        options={options}
        value={value}
        onChange={setValue}
        create={{ noun: "spending subcategory", taken: p.taken ?? [], onCreate: p.onCreate }}
      />
      <output>{value || "none"}</output>
    </form>
  );
}

it("offers Create only for a name no record has, comparing as the server does", () => {
  const onCreate = vi.fn();
  render(<Harness onCreate={onCreate} taken={["Old hobby"]} onSubmit={() => {}} />);
  const box = screen.getByRole("combobox", { name: "Subcategory" });
  // Case and repeated spaces do not make a new name; an archived name is still taken.
  for (const typed of ["  eating   OUT ", "old HOBBY"]) {
    fireEvent.change(box, { target: { value: typed } });
    expect(screen.queryByRole("option", { name: /Create/ })).toBeNull();
  }
  fireEvent.change(box, { target: { value: "  Pet   supplies " } });
  fireEvent.click(screen.getByRole("option", { name: /Create “Pet supplies”/ }));
  expect(onCreate).toHaveBeenCalledWith("Pet supplies");
});

it("chooses with the keyboard without submitting the form, and Esc keeps the choice", () => {
  const onSubmit = vi.fn();
  const onCreate = vi.fn();
  render(<Harness onCreate={onCreate} onSubmit={onSubmit} />);
  const box = screen.getByRole("combobox", { name: "Subcategory" });
  fireEvent.change(box, { target: { value: "boo" } });
  fireEvent.keyDown(box, { key: "Enter" });
  expect(screen.getByRole("status").textContent).toBe("books");
  expect(onSubmit).not.toHaveBeenCalled();
  // Typing then Esc leaves Books chosen, and the Esc stays with the box.
  fireEvent.change(box, { target: { value: "Gardening" } });
  fireEvent.keyDown(box, { key: "Escape" });
  expect(screen.getByRole("status").textContent).toBe("books");
  expect((box as HTMLInputElement).value).toBe("Books");
  expect(onSubmit).not.toHaveBeenCalled();
  // ↓ moves past the matches to Create; Enter creates.
  fireEvent.change(box, { target: { value: "Eat" } });
  fireEvent.keyDown(box, { key: "ArrowDown" });
  fireEvent.keyDown(box, { key: "Enter" });
  expect(onCreate).toHaveBeenCalledWith("Eat");
  expect(onSubmit).not.toHaveBeenCalled();
});

it("replaces a shown name with what is typed, wherever the caret is", () => {
  const onCreate = vi.fn();
  render(<Harness onCreate={onCreate} onSubmit={() => {}} />);
  const box = screen.getByRole("combobox", { name: "Subcategory" }) as HTMLInputElement;
  fireEvent.change(box, { target: { value: "books" } });
  fireEvent.keyDown(box, { key: "Enter" });
  expect(box.value).toBe("Books");
  // A second click or a tap leaves the caret after the name, not the name selected.
  box.setSelectionRange(5, 5);
  const typed = (inputType: string, data: string | null) => {
    let kept = true;
    act(() => {
      kept = box.dispatchEvent(
        new InputEvent("beforeinput", { inputType, data, cancelable: true }),
      );
    });
    return kept;
  };
  expect(typed("insertText", "P")).toBe(false);
  expect(box.value).toBe("P");
  expect(screen.getByRole("option", { name: /Create “P”/ })).toBeDefined();
  // Once searching, keys edit the search as usual.
  expect(typed("insertText", "e")).toBe(true);
  fireEvent.keyDown(box, { key: "Escape" });
  expect(box.value).toBe("Books");
  // Deleting a shown name clears it to search from nothing.
  expect(typed("deleteContentBackward", null)).toBe(false);
  expect(box.value).toBe("");
  expect(screen.getByRole("status").textContent).toBe("books");
});

/** jsdom has no PointerEvent; React reads pointerType from the native event. */
const press = (box: HTMLElement, pointerType: string) => {
  const event = new MouseEvent("pointerdown", { bubbles: true });
  Object.defineProperty(event, "pointerType", { value: pointerType });
  act(() => {
    box.dispatchEvent(event);
  });
};

it("starts an empty search on a tap, keeping the chosen name as the hint", () => {
  render(<Harness onCreate={vi.fn()} onSubmit={() => {}} />);
  const box = screen.getByRole("combobox", { name: "Subcategory" }) as HTMLInputElement;
  fireEvent.change(box, { target: { value: "books" } });
  fireEvent.keyDown(box, { key: "Enter" });
  press(box, "touch");
  expect(box.value).toBe("");
  expect(box.placeholder).toBe("Books");
  expect(screen.getAllByRole("option")).toHaveLength(3);
  // Leaving without choosing keeps the choice.
  fireEvent.blur(box);
  expect(box.value).toBe("Books");
  expect(screen.getByRole("status").textContent).toBe("books");
  // A mouse press leaves the name as it is, selected by focus.
  press(box, "mouse");
  expect(box.value).toBe("Books");
});
