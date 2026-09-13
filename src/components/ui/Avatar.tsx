import clsx from "clsx";
import { useState } from "react";

interface Props {
  name: string;
  /** A company's `domain` column, if known — fetches a real logo via unavatar.io (free, keyless, verified live) instead of initials. Falls back to initials on load failure, never a generic placeholder silhouette. */
  domain?: string | null;
  size?: "sm" | "default" | "lg";
  className?: string;
}

const PALETTE = ["bg-live-wash text-live", "bg-ghost-wash text-ghost", "bg-rule-soft text-ink-70", "bg-ink text-paper"];

const SIZE_CLASSES: Record<NonNullable<Props["size"]>, string> = {
  sm: "h-6 w-6 text-[10px]",
  default: "h-9 w-9 text-xs",
  lg: "h-12 w-12 text-sm",
};

const SIZE_PX: Record<NonNullable<Props["size"]>, number> = {
  sm: 24,
  default: 36,
  lg: 48,
};

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

function hashIndex(name: string, length: number) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return Math.abs(hash) % length;
}

export function Avatar({ name, domain, size = "default", className }: Props) {
  const [imgFailed, setImgFailed] = useState(false);

  if (domain && !imgFailed) {
    const px = SIZE_PX[size];
    return (
      <img
        src={`https://unavatar.io/${domain}?fallback=false&size=${px * 2}`}
        alt=""
        width={px}
        height={px}
        onError={() => setImgFailed(true)}
        className={clsx("shrink-0 rounded-app object-contain bg-raised", SIZE_CLASSES[size], className)}
      />
    );
  }

  return (
    <span
      className={clsx(
        "inline-flex shrink-0 items-center justify-center rounded-app font-semibold",
        SIZE_CLASSES[size],
        PALETTE[hashIndex(name, PALETTE.length)],
        className
      )}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}
