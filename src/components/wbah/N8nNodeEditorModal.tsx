/**
 * n8n-style floating node editor — modal overlay on top of the canvas.
 */
import { useEffect } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function N8nNodeEditorModal({
  open,
  onClose,
  title,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className={cn(
        "fixed inset-0 z-[120] flex items-center justify-center p-2 sm:p-5",
        className,
      )}
      role="dialog"
      aria-modal="true"
      aria-label={title ?? "Node editor"}
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/70 backdrop-blur-[2px]"
        aria-label="Close node editor"
        onClick={onClose}
      />
      <div
        className="relative z-10 flex flex-col w-full max-w-[min(1680px,98vw)] h-[min(920px,92vh)] rounded-xl border border-gray-700/90 bg-[#0f0f16] shadow-[0_24px_80px_rgba(0,0,0,0.65)] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 flex items-center justify-between gap-2 border-b border-gray-800 bg-[#13131c] px-3 py-2">
          <p className="text-[11px] text-gray-500 truncate">
            {title ?? "Node editor"}
          </p>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 shrink-0 text-gray-400 hover:text-gray-100 hover:bg-gray-800"
            onClick={onClose}
            title="Close (Esc)"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex-1 min-h-0 flex flex-col">{children}</div>
      </div>
    </div>
  );
}
