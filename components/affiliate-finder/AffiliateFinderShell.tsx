"use client";

import { useReducer } from "react";
import {
  conversationReducer,
  initialConversationState,
} from "@/lib/affiliate-finder/conversationState";
import type { Category, CreatorDetail, CreatorSummary } from "@/lib/affiliate-finder/types";
import { ChatThread } from "./ChatThread";
import { CategoryPillGroup } from "./CategoryPillGroup";
import { ThemeToggle } from "./ThemeToggle";

export function AffiliateFinderShell() {
  const [state, dispatch] = useReducer(conversationReducer, initialConversationState);

  // Category is always known up front here — the pill row is the only entry
  // point (free-text chat was tried and reverted: it depended on a
  // classifyCategory call, and structured-output schema bugs there caused
  // discovery to silently fall through to mock data far more than expected).
  // Keeping this pill-only path removes that whole failure surface.
  async function runDiscovery(category: Category) {
    dispatch({ type: "DISCOVERY_START", category });
    try {
      const res = await fetch("/api/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category }),
      });
      if (res.status === 429) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        dispatch({
          type: "NOTICE",
          content: data?.error ?? "Too many requests — please wait a moment and try again.",
        });
        return;
      }
      if (!res.ok) throw new Error("discovery request failed");
      const data = (await res.json()) as { category: Category; candidates: CreatorSummary[] };
      dispatch({ type: "DISCOVERY_SUCCESS", category: data.category, candidates: data.candidates });
    } catch {
      dispatch({
        type: "DISCOVERY_FAIL",
        content: "I couldn't reach the discovery service just now — try again in a moment.",
      });
    }
  }

  async function handleConfirmSelection() {
    dispatch({ type: "CONFIRM_SELECTION" });
    const selected = state.candidates.filter((c) => state.selectedIds.has(c.id));
    if (selected.length === 0) return;
    dispatch({ type: "ENRICH_START" });
    try {
      const res = await fetch("/api/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ creators: selected }),
      });
      if (res.status === 429) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        dispatch({
          type: "NOTICE",
          content: data?.error ?? "Too many requests — please wait a moment and try again.",
        });
        return;
      }
      if (!res.ok) throw new Error("enrichment request failed");
      const data = (await res.json()) as { details: CreatorDetail[] };
      dispatch({ type: "ENRICH_SUCCESS", details: data.details });
    } catch {
      // Fall back to a details shape with everything marked not-found rather
      // than breaking the conversation.
      const fallback: CreatorDetail[] = selected.map((c) => ({
        ...c,
        email: { value: "", found: false },
        viber: { value: "", found: false },
        mobile: { value: "", found: false },
      }));
      dispatch({ type: "ENRICH_SUCCESS", details: fallback });
    }
  }

  return (
    <div className="flex h-dvh flex-col bg-background">
      <header className="flex items-center justify-between border-b border-border px-6 py-3">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            Affiliate Finder
          </h1>
          <p className="text-sm text-muted-foreground">
            TikTok creator discovery · Philippines
          </p>
        </div>
        <ThemeToggle />
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
          <ChatThread
            messages={state.messages}
            selectedIds={state.selectedIds}
            confirmedIds={state.confirmedIds}
            onToggleSelect={(id) => dispatch({ type: "TOGGLE_SELECT", id })}
            onConfirmSelection={handleConfirmSelection}
          />
        </div>
      </div>

      {state.stage === "intake" && (
        <div className="border-t border-border">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 p-6 pt-4">
            <p className="text-sm text-muted-foreground">Pick a category to get started:</p>
            <CategoryPillGroup
              disabled={state.pending}
              onSelect={(category) => {
                dispatch({ type: "USER_MESSAGE", content: `Top affiliates — ${category}` });
                void runDiscovery(category);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
