import type { ButtonHTMLAttributes } from "react";
import clsx from "clsx";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "solid" | "ghost";
  size?: "default" | "big";
}

export function Button({ variant = "solid", size = "default", className, ...props }: Props) {
  return (
    <button
      className={clsx(
        "inline-flex items-center justify-center gap-2 rounded-app font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        size === "default" ? "px-4 py-2 text-sm" : "px-6 py-3 text-base",
        variant === "solid"
          ? "border-[1.5px] border-ink bg-ink text-paper hover:bg-black"
          : "border-[1.5px] border-ink bg-transparent text-ink hover:bg-ink/[0.07]",
        className
      )}
      {...props}
    />
  );
}
