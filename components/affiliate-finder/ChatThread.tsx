"use client";

import { useEffect, useRef } from "react";
import type { ChatMessage } from "@/lib/affiliate-finder/types";
import { AssistantBubble, AssistantPendingBubble, UserBubble } from "./MessageBubble";
import { DiscoveryResultCard } from "./DiscoveryResultCard";
import { EnrichmentSummaryCard } from "./EnrichmentSummaryCard";

export function ChatThread({
  messages,
  selectedIds,
  confirmedIds,
  onToggleSelect,
  onConfirmSelection,
}: {
  messages: ChatMessage[];
  selectedIds: Set<string>;
  confirmedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onConfirmSelection: () => void;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <>
      {messages.map((message) => {
        switch (message.kind) {
          case "text":
            return message.role === "user" ? (
              <UserBubble key={message.id} content={message.content} />
            ) : (
              <AssistantBubble key={message.id} content={message.content} />
            );
          case "pending":
            return <AssistantPendingBubble key={message.id} content={message.content} />;
          case "discovery":
            return (
              <DiscoveryResultCard
                key={message.id}
                category={message.category}
                candidates={message.candidates}
                selectedIds={selectedIds}
                confirmed={confirmedIds.size > 0}
                onToggle={onToggleSelect}
                onConfirm={onConfirmSelection}
              />
            );
          case "summary":
            return <EnrichmentSummaryCard key={message.id} details={message.details} />;
          default:
            return null;
        }
      })}
      <div ref={bottomRef} />
    </>
  );
}
