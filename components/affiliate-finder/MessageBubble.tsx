export function UserBubble({ content }: { content: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] rounded-xl bg-primary/15 px-4 py-2.5 text-sm text-foreground">
        {content}
      </div>
    </div>
  );
}

export function AssistantBubble({ content }: { content: string }) {
  return (
    <div className="flex justify-start">
      <div className="max-w-[80%] rounded-xl border border-border bg-card px-4 py-2.5 text-sm text-foreground">
        {content}
      </div>
    </div>
  );
}

export function AssistantPendingBubble({ content }: { content: string }) {
  return (
    <div className="flex justify-start">
      <div className="flex max-w-[80%] items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm text-muted-foreground">
        <span>{content}</span>
        <span className="flex gap-0.5">
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.2s]" />
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.1s]" />
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground" />
        </span>
      </div>
    </div>
  );
}
