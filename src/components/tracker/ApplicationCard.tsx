import { forwardRef } from "react";
import clsx from "clsx";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ApplicationItem } from "@/hooks/useApplications";
import { isOverdue, money, relativeDays } from "@/lib/format";
import { STAGE_LABEL } from "@/lib/stages";

interface CardProps {
  item: ApplicationItem;
  score?: number;
  /** Clock passed down from the board, so "overdue" stays honest without a per-card timer. */
  now: number;
  muted?: boolean;
  onOpen?: () => void;
  /** Set on the clone that follows the cursor — no handlers, no hover. */
  overlay?: boolean;
}

/**
 * The card body, with no drag wiring at all. Split out from the
 * sortable wrapper so the DragOverlay can render pixel-identical
 * chrome without instantiating a second useSortable for the same
 * id — which is how you get a card that fights its own ghost.
 */
export const CardBody = forwardRef<HTMLDivElement, CardProps & { dragging?: boolean }>(
  function CardBody({ item, score, now, muted, overlay, dragging, onOpen, ...rest }, ref) {
    const nextAction = relativeDays(item.next_action_at, now);
    const overdue = isOverdue(item.next_action_at, now);
    const company = item.job.company?.canonical_name ?? "an unknown company";

    return (
      <div
        ref={ref}
        {...rest}
        className={clsx(
          "group rounded-app border bg-paper px-3 py-2.5 text-left transition-shadow",
          overlay
            ? "border-ink shadow-[0_8px_24px_rgba(22,28,24,0.18)]"
            : "border-rule hover:border-ink-45",
          dragging && "opacity-40",
          muted && !overlay && "opacity-70"
        )}
      >
        <div className="flex items-start gap-2">
          <button
            type="button"
            onClick={onOpen}
            disabled={overlay}
            // The drag listeners sit on the wrapper, and they claim
            // Enter and Space. Without this the keydown bubbles up,
            // dnd-kit lifts the card, and a keyboard user can never
            // open one — the button looks focusable and does nothing.
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") e.stopPropagation();
            }}
            aria-label={`Open details for ${item.job.title} at ${company}`}
            className="min-w-0 flex-1 text-left"
          >
            <p className="truncate text-sm font-semibold leading-snug">{item.job.title}</p>
            <p className="mt-0.5 truncate text-xs text-ink-45">
              {item.job.company?.canonical_name ?? "Unknown company"}
            </p>
          </button>

          {score != null && (
            <span
              className="tabular shrink-0 rounded-full bg-live-wash px-1.5 py-0.5 text-[11px] font-semibold text-live"
              title="Match score"
            >
              {Math.round(score)}
            </span>
          )}
        </div>

        <p className="mt-1.5 truncate text-xs text-ink-70">
          {money(item.job.salary_min, item.job.salary_max, item.job.salary_currency)}
          {item.job.location ? ` · ${item.job.location}` : ""}
        </p>

        {(nextAction || item.notes) && (
          <div className="mt-2 flex items-center gap-2 border-t border-rule-soft pt-2">
            {nextAction && (
              <span
                className={clsx(
                  "truncate text-[11px] font-medium",
                  overdue ? "text-ghost" : "text-ink-70"
                )}
              >
                {overdue ? "Overdue " : "Next "}
                {nextAction}
              </span>
            )}
            {item.notes && (
              <span className="ml-auto shrink-0 text-[11px] text-ink-45" title="Has notes">
                Notes
              </span>
            )}
          </div>
        )}
      </div>
    );
  }
);

/**
 * A card on the board. The whole card is the drag handle — a
 * dedicated grip would be smaller than a fingertip on mobile —
 * while the title stays a real button, so click-to-open and
 * drag-to-move don't compete for the same gesture.
 */
export function ApplicationCard({ item, score, now, muted, onOpen }: CardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    data: { type: "application", stage: item.stage },
  });

  const company = item.job.company?.canonical_name ?? "an unknown company";

  // Two tab stops land on every card: this wrapper moves it, the
  // title button inside opens it. Labelling them apart is the whole
  // difference between a usable board and one that reads as the
  // same card twice.
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...attributes}
      {...listeners}
      aria-label={`Move ${item.job.title} at ${company}, currently in ${STAGE_LABEL[item.stage]}`}
      aria-roledescription="Draggable card"
      className="touch-none focus-visible:outline-none"
    >
      <CardBody
        item={item}
        score={score}
        now={now}
        muted={muted}
        onOpen={onOpen}
        dragging={isDragging}
      />
    </div>
  );
}
