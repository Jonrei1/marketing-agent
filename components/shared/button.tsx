import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type ButtonVariant = "solid" | "ghost";

export function Button({
  className,
  variant = "solid",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 focus:outline-none focus:ring-1 focus:ring-ring",
        variant === "solid" &&
          "bg-primary px-3.5 py-1.5 text-primary-foreground hover:bg-primary/90",
        variant === "ghost" &&
          "bg-transparent px-3.5 py-1.5 text-foreground hover:bg-muted/40 border border-border",
        className,
      )}
      {...props}
    />
  );
}
