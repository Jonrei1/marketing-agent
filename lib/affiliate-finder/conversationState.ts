import type {
  Category,
  ChatMessage,
  ConversationStage,
  CreatorDetail,
  CreatorSummary,
} from "./types";

export type ConversationState = {
  stage: ConversationStage;
  messages: ChatMessage[];
  category: Category | null;
  candidates: CreatorSummary[];
  selectedIds: Set<string>;
  confirmedIds: Set<string>;
  details: CreatorDetail[];
  pending: boolean;
};

export const initialConversationState: ConversationState = {
  stage: "intake",
  messages: [
    {
      id: "welcome",
      role: "assistant",
      kind: "text",
      content:
        "Hi! Tell me what kind of TikTok affiliates you're looking for and I'll pull the top 10 ranked creators for it.",
    },
  ],
  category: null,
  candidates: [],
  selectedIds: new Set(),
  confirmedIds: new Set(),
  details: [],
  pending: false,
};

export type ConversationAction =
  | { type: "USER_MESSAGE"; content: string }
  | { type: "DISCOVERY_START" }
  | { type: "DISCOVERY_SUCCESS"; category: Category; candidates: CreatorSummary[] }
  | { type: "DISCOVERY_FAIL"; content: string }
  | { type: "TOGGLE_SELECT"; id: string }
  | { type: "CONFIRM_SELECTION" }
  | { type: "ENRICH_START" }
  | { type: "ENRICH_SUCCESS"; details: CreatorDetail[] }
  | { type: "NOTICE"; content: string }
  | { type: "RESET" };

function uid(prefix: string) {
  return `${prefix}-${Math.round(Math.random() * 1e9)}`;
}

export function conversationReducer(
  state: ConversationState,
  action: ConversationAction,
): ConversationState {
  switch (action.type) {
    case "USER_MESSAGE":
      return {
        ...state,
        messages: [
          ...state.messages,
          { id: uid("u"), role: "user", kind: "text", content: action.content },
        ],
      };

    case "DISCOVERY_START":
      return {
        ...state,
        stage: "discovery",
        pending: true,
        messages: [
          ...state.messages,
          {
            id: uid("p"),
            role: "assistant",
            kind: "pending",
            content: "Finding the top 10 creators for that…",
          },
        ],
      };

    case "DISCOVERY_SUCCESS":
      return {
        ...state,
        stage: "selection",
        pending: false,
        category: action.category,
        candidates: action.candidates,
        selectedIds: new Set(),
        messages: [
          ...state.messages.filter((m) => m.kind !== "pending"),
          {
            id: uid("d"),
            role: "assistant",
            kind: "discovery",
            category: action.category,
            candidates: action.candidates,
          },
        ],
      };

    case "DISCOVERY_FAIL":
      return {
        ...state,
        stage: "intake",
        pending: false,
        messages: [
          ...state.messages.filter((m) => m.kind !== "pending"),
          { id: uid("a"), role: "assistant", kind: "text", content: action.content },
        ],
      };

    case "TOGGLE_SELECT": {
      const next = new Set(state.selectedIds);
      if (next.has(action.id)) next.delete(action.id);
      else next.add(action.id);
      return { ...state, selectedIds: next };
    }

    case "CONFIRM_SELECTION":
      if (state.selectedIds.size === 0) return state;
      return {
        ...state,
        stage: "enrichment",
        confirmedIds: new Set(state.selectedIds),
        messages: [
          ...state.messages,
          {
            id: uid("u"),
            role: "user",
            kind: "text",
            content: `Confirmed ${state.selectedIds.size} creator${state.selectedIds.size === 1 ? "" : "s"} for enrichment.`,
          },
        ],
      };

    case "ENRICH_START":
      return {
        ...state,
        pending: true,
        messages: [
          ...state.messages,
          {
            id: uid("p"),
            role: "assistant",
            kind: "pending",
            content: "Looking up contact details for the selected creators…",
          },
        ],
      };

    case "ENRICH_SUCCESS":
      return {
        ...state,
        stage: "summary",
        pending: false,
        details: action.details,
        messages: [
          ...state.messages.filter((m) => m.kind !== "pending"),
          {
            id: uid("s"),
            role: "assistant",
            kind: "summary",
            details: action.details,
          },
        ],
      };

    case "NOTICE":
      // Surfaces a message (e.g. rate-limit backoff) without touching stage
      // or clearing pending — the in-flight action just didn't complete yet.
      return {
        ...state,
        pending: false,
        messages: [
          ...state.messages.filter((m) => m.kind !== "pending"),
          { id: uid("n"), role: "assistant", kind: "text", content: action.content },
        ],
      };

    case "RESET":
      return initialConversationState;

    default:
      return state;
  }
}
