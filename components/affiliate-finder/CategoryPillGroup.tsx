"use client";

import { cn } from "@/lib/utils";
import { CATEGORIES } from "@/lib/affiliate-finder/types";
import type { Category } from "@/lib/affiliate-finder/types";

export function CategoryPillGroup({
  onSelect,
  disabled,
}: {
  onSelect: (category: Category) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {CATEGORIES.map((category) => (
        <button
          key={category}
          type="button"
          onClick={() => onSelect(category)}
          disabled={disabled}
          className={cn(
            "rounded-full border border-border bg-card px-4 py-1.5 text-sm font-medium text-foreground",
            "transition-colors hover:bg-muted/40 disabled:pointer-events-none disabled:opacity-50",
          )}
        >
          {category[0].toUpperCase() + category.slice(1)}
        </button>
      ))}
    </div>
  );
}
