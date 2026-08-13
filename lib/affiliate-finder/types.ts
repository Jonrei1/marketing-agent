export type Category = "beauty" | "skincare" | "sunscreen";

export const CATEGORIES: Category[] = ["beauty", "skincare", "sunscreen"];

export type CreatorSummary = {
  id: string;
  username: string;
  displayName: string;
  profileUrl: string; // full TikTok profile URL, e.g. https://www.tiktok.com/@handle
  followers: number;
  engagementRate: number; // 0–1
  gmv: number; // ESTIMATED — from Claude, Apify+mock merge, or mock data; never a scraped live figure
  itemsSold: number; // ESTIMATED — same basis as gmv, never a scraped live figure
  bio: string; // source text for contact-field enrichment
};

export type ContactField = {
  value: string;
  found: boolean;
};

export type CreatorDetail = CreatorSummary & {
  email: ContactField;
  viber: ContactField;
  mobile: ContactField;
};

export type ConversationStage =
  | "intake"
  | "discovery"
  | "selection"
  | "enrichment"
  | "summary";

export type DiscoveryPayload = {
  category: Category;
  candidates: CreatorSummary[];
};

export type SummaryPayload = {
  details: CreatorDetail[];
};

export type ChatMessage =
  | { id: string; role: "user"; kind: "text"; content: string }
  | { id: string; role: "assistant"; kind: "text"; content: string }
  | { id: string; role: "assistant"; kind: "pending"; content: string }
  | ({ id: string; role: "assistant"; kind: "discovery" } & DiscoveryPayload)
  | ({ id: string; role: "assistant"; kind: "summary" } & SummaryPayload);
