import { useRef, type KeyboardEvent } from "react";

type GridPosition = { row: number; col: number };
type GridActions = {
  rowId: string;
  position: GridPosition;
  rows: number;
  columns: number;
  move: (position: GridPosition) => void;
  edit?: () => void;
  add?: () => void;
  remove?: () => void;
  help?: () => void;
};

/** Normal-mode navigation only. The feature owns editing, validation and saving. */
export function useGridKeys() {
  const sequence = useRef<{ key: string; rowId: string; time: number } | null>(null);
  return (event: KeyboardEvent, actions: GridActions) => {
    if (
      event.defaultPrevented ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      (event.target instanceof HTMLElement &&
        event.target.closest("input,textarea,select,[contenteditable],[role=textbox]"))
    )
      return;
    const { key } = event;
    const previous = sequence.current;
    sequence.current = null;
    let { row, col } = actions.position;
    if (key === "g" || key === "d") {
      event.preventDefault();
      if (event.repeat) return;
      if (
        previous?.key === key &&
        previous.rowId === actions.rowId &&
        Date.now() - previous.time < 700
      ) {
        if (key === "g") actions.move({ row: 0, col });
        else actions.remove?.();
      } else sequence.current = { key, rowId: actions.rowId, time: Date.now() };
      return;
    }
    const action =
      key === "i" || key === "Enter"
        ? actions.edit
        : key === "a" || key === "A"
          ? actions.add
          : key === "?"
            ? actions.help
            : undefined;
    if (action) {
      event.preventDefault();
      if (!event.repeat) action();
      return;
    }
    if (key === "h" || key === "ArrowLeft") col--;
    else if (key === "l" || key === "ArrowRight") col++;
    else if (key === "j" || key === "ArrowDown") row++;
    else if (key === "k" || key === "ArrowUp") row--;
    else if (key === "0" || key === "Home") col = 0;
    else if (key === "$" || key === "End") col = actions.columns - 1;
    else if (key === "G") row = actions.rows - 1;
    else return;
    event.preventDefault();
    if (actions.rows > 0 && actions.columns > 0)
      actions.move({
        row: Math.max(0, Math.min(actions.rows - 1, row)),
        col: Math.max(0, Math.min(actions.columns - 1, col)),
      });
  };
}
