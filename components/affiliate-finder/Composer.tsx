"use client";

import { useState, type ChangeEvent, type KeyboardEvent } from "react";
import { ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";

// Hard cutoff for a single chat message — a brand user typing a runaway
// paste shouldn't blow up the category-detection logic or (indirectly) the
// enrichment prompt. Input is truncated automatically, not rejected.
export const MAX_MESSAGE_LENGTH = 500;

export function Composer({
  onSend,
  disabled,
  placeholder = "Describe the affiliates you're looking for…",
}: {
  onSend: (content: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [value, setValue] = useState("");

  function send() {
    const trimmed = value.trim().slice(0, MAX_MESSAGE_LENGTH);
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue("");
  }

  function handleChange(e: ChangeEvent<HTMLTextAreaElement>) {
    setValue(e.target.value.slice(0, MAX_MESSAGE_LENGTH));
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  const atLimit = value.length >= MAX_MESSAGE_LENGTH;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-end gap-2 rounded-xl border border-border bg-card px-4 py-3 focus-within:ring-1 focus-within:ring-ring">
        <textarea
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder={placeholder}
          rows={1}
          maxLength={MAX_MESSAGE_LENGTH}
          className="flex-1 resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-50"
        />
        <button
          type="button"
          onClick={send}
          disabled={disabled || !value.trim()}
          aria-label="Send message"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
        >
          <ArrowUp className="h-4 w-4 shrink-0" />
        </button>
      </div>
      {atLimit && (
        <span className={cn("px-1 text-xs text-muted-foreground")}>
          {MAX_MESSAGE_LENGTH} character limit reached — message will be sent as-is.
        </span>
      )}
    </div>
  );
}
