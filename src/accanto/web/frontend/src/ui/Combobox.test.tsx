import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
