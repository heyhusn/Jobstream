import type { ReactNode } from "react";
import * as RadixTabs from "@radix-ui/react-tabs";
import clsx from "clsx";

export const Tabs = RadixTabs.Root;

export function TabsList({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <RadixTabs.List className={clsx("flex items-center gap-1 overflow-x-auto border-b border-rule", className)}>
      {children}
    </RadixTabs.List>
  );
}

export function TabsTrigger({ value, children }: { value: string; children: ReactNode }) {
  return (
    <RadixTabs.Trigger
      value={value}
      className="shrink-0 border-b-[1.5px] border-transparent px-3 py-2 text-sm font-medium text-ink-70 transition-colors hover:text-ink data-[state=active]:border-ink data-[state=active]:text-ink"
    >
      {children}
    </RadixTabs.Trigger>
  );
}

export function TabsContent({
  value,
  children,
  className,
}: {
  value: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <RadixTabs.Content value={value} className={clsx("pt-5 focus:outline-none", className)}>
      {children}
    </RadixTabs.Content>
  );
}
