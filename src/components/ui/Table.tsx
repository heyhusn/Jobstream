import type { ReactNode, TableHTMLAttributes } from "react";
import clsx from "clsx";

export function Table({ className, ...props }: TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-x-auto rounded-app border border-rule">
      <table className={clsx("w-full text-left text-sm", className)} {...props} />
    </div>
  );
}

export function Thead({ children }: { children: ReactNode }) {
  return (
    <thead className="border-b border-rule bg-rule-soft/40 text-xs uppercase tracking-wide text-ink-45">
      {children}
    </thead>
  );
}

export function Th({ children, className }: { children: ReactNode; className?: string }) {
  return <th className={clsx("px-4 py-2.5 font-medium", className)}>{children}</th>;
}

export function Td({ children, className }: { children: ReactNode; className?: string }) {
  return <td className={clsx("px-4 py-2.5", className)}>{children}</td>;
}

export function Tr({ children, className }: { children: ReactNode; className?: string }) {
  return <tr className={clsx("border-b border-rule/60 last:border-b-0", className)}>{children}</tr>;
}
