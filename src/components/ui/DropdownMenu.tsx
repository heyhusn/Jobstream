import type { ReactNode } from "react";
import * as RadixDropdown from "@radix-ui/react-dropdown-menu";
import clsx from "clsx";

export const DropdownMenu = RadixDropdown.Root;
export const DropdownMenuTrigger = RadixDropdown.Trigger;

export function DropdownMenuContent({
  children,
  align = "end",
  className,
}: {
  children: ReactNode;
  align?: "start" | "end" | "center";
  className?: string;
}) {
  return (
    <RadixDropdown.Portal>
      <RadixDropdown.Content
        align={align}
        sideOffset={8}
        className={clsx(
          "z-50 min-w-[180px] rounded-app border border-rule bg-raised p-1 shadow-lg focus:outline-none",
          className
        )}
      >
        {children}
      </RadixDropdown.Content>
    </RadixDropdown.Portal>
  );
}

export function DropdownMenuItem({
  children,
  onSelect,
  className,
  destructive,
  asChild,
}: {
  children: ReactNode;
  onSelect?: () => void;
  className?: string;
  destructive?: boolean;
  asChild?: boolean;
}) {
  return (
    <RadixDropdown.Item
      asChild={asChild}
      onSelect={onSelect}
      className={clsx(
        "flex cursor-pointer items-center gap-2 rounded-app px-3 py-2 text-sm outline-none transition-colors",
        destructive ? "text-ghost hover:bg-ghost-wash" : "text-ink hover:bg-rule-soft",
        className
      )}
    >
      {children}
    </RadixDropdown.Item>
  );
}

export function DropdownMenuSeparator() {
  return <RadixDropdown.Separator className="my-1 h-px bg-rule" />;
}

export function DropdownMenuLabel({ children }: { children: ReactNode }) {
  return <RadixDropdown.Label className="px-3 py-1.5 text-xs text-ink-45">{children}</RadixDropdown.Label>;
}
