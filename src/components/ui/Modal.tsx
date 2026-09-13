import type { ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import clsx from "clsx";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  side?: "center" | "right";
  className?: string;
}

/**
 * Radix owns the focus trap / Escape / scroll-lock here — replaces the
 * hand-rolled versions of this in ApplicationDrawer (and the click-outside
 * logic in NotificationBell's dropdown) with one audited implementation
 * instead of several slightly different ones.
 */
export function Modal({ open, onOpenChange, title, description, children, side = "center", className }: Props) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-ink/40" />
        <Dialog.Content
          className={clsx(
            "fixed z-50 flex flex-col bg-paper shadow-xl focus:outline-none",
            side === "center" &&
              "left-1/2 top-1/2 max-h-[85vh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-app border border-rule",
            side === "right" && "right-0 top-0 h-full w-full max-w-xl border-l border-rule",
            className
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-rule px-6 py-4">
            <div>
              <Dialog.Title className="font-display text-lg font-semibold">{title}</Dialog.Title>
              {description && (
                <Dialog.Description className="mt-1 text-sm text-ink-70">{description}</Dialog.Description>
              )}
            </div>
            <Dialog.Close className="shrink-0 rounded-app p-1 text-ink-45 transition-colors hover:bg-rule-soft hover:text-ink">
              <X size={18} />
            </Dialog.Close>
          </div>
          <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
