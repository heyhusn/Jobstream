import { useMemo, useState } from "react";
import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import type { ApplicationStage } from "@/types/database";
import { STAGE_IDS, STAGE_LABEL, isStageId } from "@/lib/stages";
import {
  applicationsKey,
  flattenBoard,
  groupByStage,
  useReorderApplications,
  type ApplicationItem,
  type Board,
} from "@/hooks/useApplications";
import { moveToStage, reorderWithin } from "@/lib/board";
import { useAuth } from "@/hooks/useAuth";
import { useNow } from "@/hooks/useNow";
import { useEffectiveStages } from "@/hooks/useKanbanStagePrefs";
import { TrackerColumn } from "./TrackerColumn";
import { CardBody } from "./ApplicationCard";
import { ApplicationDrawer } from "./ApplicationDrawer";

interface Props {
  applications: ApplicationItem[];
  scores: Record<string, number>;
}

interface PendingPosition {
  stage: ApplicationStage;
  stage_order: number;
}

/**
 * `closestCorners` alone never reports "nothing" — it always names
 * the nearest column, however far outside the board the pointer is.
 * That turns letting go in empty space into a silent move to
 * whichever column happened to be closest. Requiring an actual
 * overlap first gives the drag a way to end in nothing, which is
 * what a release over open space should mean; inside the board,
 * closestCorners still does the fine-grained work.
 */
const collisionDetection: CollisionDetection = (args) => {
  const pointer = pointerWithin(args);
  if (pointer.length > 0) return pointer;
  if (rectIntersection(args).length === 0) return [];
  return closestCorners(args);
};

function findStage(board: Board, id: UniqueIdentifier | null): ApplicationStage | null {
  if (id == null) return null;
  const key = String(id);
  if (isStageId(key)) return key;
  return STAGE_IDS.find((s) => board[s].some((i) => i.id === key)) ?? null;
}

export function TrackerBoard({ applications, scores }: Props) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const reorder = useReorderApplications();
  const now = useNow();
  // Minor m19: customized labels/order/visibility layered over the
  // fixed six stages — the drag-and-drop mechanics below still key
  // off STAGE_IDS/STAGE_LABEL untouched, since only what's rendered
  // (not the underlying stage values) is customizable.
  const effectiveStages = useEffectiveStages();

  // Positions a finished drag is still saving, by application id.
  //
  // The optimistic cache write isn't enough on its own: any other
  // mutation that invalidates this query — deleting a different card,
  // editing a note — refetches and overwrites the drag with rows the
  // server hasn't been told about yet, so the card visibly jumps back
  // for as long as the save takes and then jumps forward again.
  //
  // Positions rather than a frozen board, deliberately: which rows
  // exist still comes from the query, so a card deleted during the
  // save disappears immediately instead of hanging around until the
  // drag finishes writing.
  const [pending, setPending] = useState<Map<string, PendingPosition> | null>(null);
  const isFetching = useIsFetching({ queryKey: applicationsKey(user?.id) });

  // Applied only while the write is genuinely in flight — the
  // mutation running, or its invalidation still refetching. Once
  // both are quiet the query holds the truth, and re-applying these
  // positions would be a no-op anyway since the write succeeded.
  const settling = reorder.isPending || isFetching > 0;
  const positions = settling ? pending : null;

  const serverBoard = useMemo(
    () =>
      groupByStage(
        positions
          ? applications.map((a) => {
              const at = positions.get(a.id);
              return at ? { ...a, stage: at.stage, stage_order: at.stage_order } : a;
            })
          : applications
      ),
    [applications, positions]
  );

  // While a card is in flight the board is driven by local state,
  // so cross-column previews are instant and don't wait on a round
  // trip. It's dropped the moment the cache is written with the
  // committed arrangement — in the same tick, so nothing flashes.
  const [dragBoard, setDragBoard] = useState<Board | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const board = dragBoard ?? serverBoard;

  const sensors = useSensors(
    // A small threshold before a drag begins, so tapping a card to
    // open its drawer isn't read as a one-pixel drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const activeItem = activeId
    ? (STAGE_IDS.flatMap((s) => board[s]).find((i) => i.id === activeId) ?? null)
    : null;

  const openItem = openId ? (applications.find((a) => a.id === openId) ?? null) : null;

  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${describe(board, active.id)}.`,
    onDragOver: ({ active, over }) => {
      const stage = findStage(board, over?.id ?? null);
      if (!stage) return undefined;
      return `${describe(board, active.id)} is over ${STAGE_LABEL[stage]}.`;
    },
    onDragEnd: ({ active, over }) => {
      const stage = findStage(board, over?.id ?? null);
      if (!stage) return `${describe(board, active.id)} was dropped.`;
      return `${describe(board, active.id)} was moved to ${STAGE_LABEL[stage]}.`;
    },
    onDragCancel: ({ active }) => `Move cancelled. ${describe(board, active.id)} stayed put.`,
  };

  function handleDragStart(event: DragStartEvent) {
    setPending(null);
    setActiveId(String(event.active.id));
    setDragBoard(serverBoard);
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) return;

    const current = dragBoard ?? serverBoard;
    const from = findStage(current, active.id);
    const to = findStage(current, over.id);
    // Same-column reordering is settled on drop; doing it here too
    // makes cards jitter under the cursor as they trade places.
    if (!from || !to || from === to) return;

    const activeKey = String(active.id);
    const overKey = String(over.id);
    const overCardId = isStageId(overKey) ? null : overKey;

    // Drop above or below the hovered card, depending on which half
    // of it the dragged card's top edge has crossed.
    const translated = active.rect.current.translated;
    const below =
      translated != null && over.rect != null
        ? translated.top > over.rect.top + over.rect.height / 2
        : false;

    setDragBoard((prev) =>
      moveToStage(prev ?? serverBoard, activeKey, from, to, overCardId, below)
    );
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    const current = dragBoard ?? serverBoard;

    // Released over nothing — below the board, off the side. The
    // cross-column preview has already moved the card in dragBoard,
    // so committing here would silently drop it wherever the
    // pointer last passed. Letting go in empty space means cancel.
    if (!over) {
      handleDragCancel();
      return;
    }

    let next = current;
    const from = findStage(current, active.id);
    const to = findStage(current, over.id);

    if (from && to && from === to) {
      const overKey = String(over.id);
      next = reorderWithin(current, from, String(active.id), isStageId(overKey) ? null : overKey);
    }

    // flattenBoard renumbers stage_order from the array index, so
    // the first drag also normalises whatever gaps the seed data
    // or a save-to-top insert left behind. After that a drop
    // dirties only the handful of rows that genuinely moved.
    const committed = flattenBoard(next);
    const previous = applications;

    qc.setQueryData(applicationsKey(user?.id), committed);
    setPending(new Map(committed.map((a) => [a.id, { stage: a.stage, stage_order: a.stage_order }])));
    setDragBoard(null);
    setActiveId(null);

    reorder.mutate(
      { next: committed, previous },
      // A failed save rolls the cache back; stop showing the
      // arrangement that didn't happen.
      { onError: () => setPending(null) }
    );
  }

  function handleDragCancel() {
    setDragBoard(null);
    setActiveId(null);
  }

  return (
    <>
      {reorder.isError && (
        <p
          role="alert"
          className="mb-4 rounded-app border border-ghost/40 bg-ghost-wash px-4 py-2.5 text-sm text-ghost"
        >
          That move didn't save — the board's been put back where it was. Check your connection and
          try again.
        </p>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        accessibility={{
          announcements,
          screenReaderInstructions: {
            draggable:
              "Press space or enter to pick up a card, then use the arrow keys to move it between " +
              "stages and positions, and space or enter again to drop it. Escape cancels the move. " +
              "You can also open a card and change its stage from the details panel.",
          },
        }}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div className="-mx-6 overflow-x-auto px-6 pb-4">
          <div className="flex min-h-[420px] items-stretch gap-3">
            {effectiveStages
              .filter((s) => !s.hidden)
              .map((s) => (
                <TrackerColumn
                  key={s.id}
                  stage={s.id}
                  label={s.label}
                  terminal={s.terminal}
                  emptyHint={s.emptyHint}
                  items={board[s.id]}
                  scores={scores}
                  now={now}
                  onOpen={setOpenId}
                  isDragging={activeId != null}
                />
              ))}
          </div>
        </div>

        <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(0.2, 0, 0, 1)" }}>
          {activeItem && (
            <div className="w-[256px] rotate-[1.5deg]">
              <CardBody item={activeItem} score={scores[activeItem.job.id]} now={now} overlay />
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {openItem && (
        <ApplicationDrawer
          key={openItem.id}
          item={openItem}
          score={scores[openItem.job.id]}
          onClose={() => setOpenId(null)}
        />
      )}
    </>
  );
}

function describe(board: Board, id: UniqueIdentifier): string {
  const key = String(id);
  const item = STAGE_IDS.flatMap((s) => board[s]).find((i) => i.id === key);
  if (!item) return "card";
  return `${item.job.title} at ${item.job.company?.canonical_name ?? "an unknown company"}`;
}
