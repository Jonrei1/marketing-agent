import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

export function Checkbox({
  checked,
  onCheckedChange,
  disabled,
  className,
  "aria-label": ariaLabel,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border border-border transition-colors focus:outline-none focus:ring-1 focus:ring-ring disabled:pointer-events-none disabled:opacity-50",
        checked ? "bg-primary border-primary" : "bg-background",
        className,
      )}
    >
      {checked && <Check className="h-3 w-3 shrink-0 text-primary-foreground" />}
    </button>
  );
}
