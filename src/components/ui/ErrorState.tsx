interface Props {
  title?: string;
  body?: string;
  onRetry?: () => void;
}

/**
 * Distinct from EmptyState on purpose: "nothing here" and
 * "something broke" need different colour, different copy, and a
 * retry affordance — collapsing them into one component is how
 * you end up telling someone their search failed when it actually
 * just found nothing.
 */
export function ErrorState({
  title = "Couldn't load this",
  body = "That's on us, not you. Try again in a moment.",
  onRetry,
}: Props) {
  return (
    <div className="rounded-app border border-ghost/40 bg-ghost-wash px-8 py-14 text-center">
      <h3 className="text-lg font-semibold text-ghost">{title}</h3>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-ink-70">{body}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-5 rounded-app border border-ink px-4 py-2 text-sm font-medium hover:bg-ink hover:text-paper"
        >
          Try again
        </button>
      )}
    </div>
  );
}
