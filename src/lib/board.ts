import type { ApplicationStage } from "@/types/database";
import type { ApplicationItem, Board } from "@/hooks/useApplications";

/**
 * The two moves a drag can make, as pure functions over a board.
 *
 * They live here rather than inside the component because the
 * index arithmetic is the part most likely to be subtly wrong
 * (drop above vs. below the hovered card, drop onto an empty
 * column, drop onto a column header) and it's only checkable if
 * it doesn't need a DOM and a pointer to run.
 */

/** Move a card into a different stage, at the position it's hovering. */
export function moveToStage(
  board: Board,
  activeId: string,
  from: ApplicationStage,
  to: ApplicationStage,
  /** The card being hovered, or null when hovering the column itself. */
  overId: string | null,
  /** True when the dragged card's top has passed the hovered card's midpoint. */
  below: boolean
): Board {
  if (from === to) return board;

  const source = [...board[from]];
  const target = [...board[to]];
  const index = source.findIndex((i) => i.id === activeId);
  if (index < 0) return board;

  const [moved] = source.splice(index, 1);

  const overIndex = overId == null ? -1 : target.findIndex((i) => i.id === overId);
  // Hovering the column rather than a card means "append" — that's
  // the only sensible read of a drop into open space below the last
  // card, and the only reachable one in an empty column.
  const insertAt = overIndex >= 0 ? overIndex + (below ? 1 : 0) : target.length;

  target.splice(insertAt, 0, { ...moved, stage: to });

  return { ...board, [from]: source, [to]: target };
}

/** Reorder within one stage. */
export function reorderWithin(
  board: Board,
  stage: ApplicationStage,
  activeId: string,
  /** The card being hovered, or null when hovering the column itself (drop to the end). */
  overId: string | null
): Board {
  const items = board[stage];
  const oldIndex = items.findIndex((i) => i.id === activeId);
  if (oldIndex < 0) return board;

  const newIndex = overId == null ? items.length - 1 : items.findIndex((i) => i.id === overId);
  if (newIndex < 0 || newIndex === oldIndex) return board;

  const next = [...items];
  const [moved] = next.splice(oldIndex, 1);
  next.splice(newIndex, 0, moved);

  return { ...board, [stage]: next };
}

/** The rows whose stage or position actually changed. */
export function dirtyRows(
  next: ApplicationItem[],
  previous: ApplicationItem[]
): ApplicationItem[] {
  const before = new Map(previous.map((a) => [a.id, a]));
  return next.filter((a) => {
    const was = before.get(a.id);
    return !was || was.stage !== a.stage || was.stage_order !== a.stage_order;
  });
}
