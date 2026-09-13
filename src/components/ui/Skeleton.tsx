import clsx from "clsx";

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx("animate-pulse rounded-app bg-rule-soft", className)} aria-hidden="true" />;
}

export function SkeletonRow({ className }: { className?: string }) {
  return (
    <div className={clsx("flex items-center gap-3 rounded-app border border-rule bg-raised p-4", className)}>
      <Skeleton className="h-9 w-9 shrink-0" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-3.5 w-1/3" />
        <Skeleton className="h-3 w-2/3" />
      </div>
    </div>
  );
}

export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={clsx("space-y-3 rounded-app border border-rule bg-raised p-5", className)}>
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-5/6" />
    </div>
  );
}
