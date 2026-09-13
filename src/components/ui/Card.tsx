import type { HTMLAttributes } from "react";
import clsx from "clsx";

interface Props extends HTMLAttributes<HTMLDivElement> {
  padding?: "none" | "default" | "lg";
}

export function Card({ padding = "default", className, ...props }: Props) {
  return (
    <div
      className={clsx(
        "rounded-app border border-rule bg-raised",
        padding === "default" && "p-5",
        padding === "lg" && "p-8",
        className
      )}
      {...props}
    />
  );
}
