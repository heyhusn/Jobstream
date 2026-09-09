import clsx from "clsx";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { ApplicationItem } from "@/hooks/useApplications";
import type { ApplicationStage } from "@/types/database";
import { ApplicationCard } from "./ApplicationCard";

interface Props {
  stage: ApplicationStage;
  label: string;
  terminal: boolean;
  emptyHint: string;
  items: ApplicationItem[];
  scores: Record<string, number>;
  now: number;
  onOpen: (id: string) => void;
  /** True while any card is in flight, so empty columns can advertise themselves. */
  isDragging: boolean;
}

export function TrackerColumn({
  stage,
  label,
  terminal,
  emptyHint,
  items,
  scores,
  now,
  onOpen,
  isDragging,
}: Props) {
  // Droppable on the column itself, not just the sortable list —
  // otherwise an empty column has no geometry to drop onto and
  // you can never move the first card into it.
  const { setNodeRef, isOver } = useDroppable({ id: stage, data: { type: "column", stage } });

  return (
    <section
      className="flex w-[272px] shrink-0 flex-col"
      aria-label={`${label}, ${items.length} ${items.length === 1 ? "application" : "applications"}`}
    >
      <header className="mb-2 flex items-baseline gap-2 px-1">
        <h2 className={clsx("text-sm font-semibold", terminal && "text-ink-45")}>{label}</h2>
        <span className="tabular text-xs text-ink-45">{items.length}</span>
      </header>

      <div
        ref={setNodeRef}
        className={clsx(
          "flex-1 rounded-app border p-2 transition-colors",
          isOver
            ? "border-live bg-live-wash/50"
            : terminal
              ? "border-rule-soft bg-raised/50"
              : "border-rule bg-raised"
        )}
      >
        <SortableContext
          items={items.map((i) => i.id)}
          strategy={verticalListSortingStrategy}
          id={stage}
        >
          <div className="flex min-h-[120px] flex-col gap-2">
            {items.map((item) => (
              <ApplicationCard
                key={item.id}
                item={item}
                score={scores[item.job.id]}
                now={now}
                muted={terminal}
                onOpen={() => onOpen(item.id)}
              />
            ))}

            {items.length === 0 && (
              <p
                className={clsx(
                  "grid flex-1 place-items-center rounded-app border border-dashed px-3 py-6 text-center text-xs leading-relaxed transition-colors",
                  isDragging ? "border-live text-live" : "border-rule text-ink-45"
                )}
              >
                {isDragging ? `Drop to move to ${label}` : emptyHint}
              </p>
            )}
          </div>
        </SortableContext>
      </div>
    </section>
  );
}
