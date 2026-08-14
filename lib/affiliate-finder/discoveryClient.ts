// Server-only module: reads process.env.ANTHROPIC_API_KEY and is only ever
// imported from app/api/discover/route.ts, never from a client component.
//
// Claude's job in discovery is SCOPING ONLY, not finding creators itself.
// scopeRequest reads the user's free-text chat message and turns it into (a)
// a product category and (b) a short list of TikTok Shop search keywords —
// one fast, tool-less call. apifyClient.ts takes those keywords and does the
// actual scraping (real product GMV + affiliate creator discovery), which is
// the primary discovery engine, with mock data as its own fallback. This
// replaces the old discoverWithClaude, which used web_search + web_fetch (up
// to 6 uses each, chained) as the primary discovery path — that call chain
// was the main source of slow discovery turnaround; scoping alone is one
// short non-tool call, and there is now exactly one Claude call per
// discovery request instead of two.
import Anthropic from "@anthropic-ai/sdk";
import { CATEGORIES } from "./types";
import type { Category } from "./types";

const MAX_MESSAGE_CHARS = 500; // matches Composer.tsx's MAX_MESSAGE_LENGTH
const MAX_KEYWORDS = 3; // keep the Apify shop-search query short and cheap

function getClient(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  return new Anthropic({ apiKey });
}

// Grounds the scoping call in what the brand actually sells, so a vague
// message ("who can move a lot of product for us?") still scopes to
// sensible PH TikTok Shop search terms instead of generic beauty keywords.
// Keep this a short, factual description — it's context for interpreting the
// user's message, not instructions Claude should follow on its own.
const BRAND_CONTEXT =
  "The brand running this tool is Biocostech, a sunscreen/skincare brand selling in the Philippines " +
  "market. Default to sunscreen/skincare interpretations when the user's message is ambiguous or " +
  "doesn't name a category, but follow the user's own wording when they're specific about something " +
  "else (e.g. makeup, haircare).";

// Used both as the no-key/error fallback and as a last-resort default
// keyword set — always PH-shopper phrasing, never a bare English category
// name, since these go straight into a TikTok Shop search.
const DEFAULT_KEYWORDS: Record<Category, string[]> = {
  beauty: ["makeup finds", "beauty must haves"],
  skincare: ["skincare routine", "face serum"],
  sunscreen: ["sunscreen spf50", "sunblock"],
};

export type ScopedRequest = {
  category: Category | null;
  searchKeywords: string[];
};

const SCOPE_SCHEMA = {
  type: "object",
  properties: {
    category: {
      anyOf: [{ type: "string", enum: CATEGORIES }, { type: "null" }],
      description: "The product category this message is asking about, or null if it doesn't clearly name one.",
    },
    searchKeywords: {
      type: "array",
      items: { type: "string" },
      description:
        "1-3 concise TikTok Shop search phrases (2-4 words each) that best scope this request for a " +
        "Philippines TikTok Shop search — product or niche terms a PH shopper would type, e.g. " +
        "\"sunscreen spf50\", \"matte lip tint\". Not a description of the request, an actual search query.",
    },
  },
  required: ["category", "searchKeywords"],
  additionalProperties: false,
};

// Turns a free-text chat message into a category + search keywords for
// apifyClient's TikTok Shop scraper. Never throws — falls back to keyword
// matching / DEFAULT_KEYWORDS on any missing key, refusal, empty result, or
// error, same contract as the rest of this module.
export async function scopeRequest(message: string): Promise<ScopedRequest> {
  const truncated = message.length > MAX_MESSAGE_CHARS ? message.slice(0, MAX_MESSAGE_CHARS) : message;
  const client = getClient();
  if (!client) {
    console.warn("[discoveryClient] ANTHROPIC_API_KEY not set — using keyword fallback for scoping");
    return keywordFallback(truncated);
  }

  try {
    const response = await client.messages.parse({
      model: "claude-sonnet-5",
      max_tokens: 256,
      // No tools here — this is a scoping call, not a discovery call. Real
      // creator/GMV data comes from apifyClient.ts.
      output_config: { format: { type: "json_schema", schema: SCOPE_SCHEMA } },
      messages: [
        {
          role: "user",
          content:
            `${BRAND_CONTEXT}\n\nA user of the brand's internal tool typed this chat message describing ` +
            `the TikTok affiliate creators they're looking for:\n\n"${truncated}"\n\nIdentify the product ` +
            `category (beauty, skincare, or sunscreen — or null if genuinely unclear) and produce up to ` +
            `${MAX_KEYWORDS} concise TikTok Shop search keywords/phrases that best scope this request.`,
        },
      ],
    });

    if (response.stop_reason === "refusal") {
      console.warn("[discoveryClient] scoping refused — using keyword fallback");
      return keywordFallback(truncated);
    }
    const parsed = response.parsed_output as ScopedRequest | null;
    if (!parsed || !Array.isArray(parsed.searchKeywords) || parsed.searchKeywords.length === 0) {
      console.warn("[discoveryClient] scoping returned nothing — using keyword fallback");
      return keywordFallback(truncated);
    }
    const category = parsed.category && CATEGORIES.includes(parsed.category) ? parsed.category : null;
    return { category, searchKeywords: parsed.searchKeywords.slice(0, MAX_KEYWORDS) };
  } catch (err) {
    console.warn("[discoveryClient] scoping failed, using keyword fallback:", err);
    return keywordFallback(truncated);
  }
}

// Keyword fallback used only when the Claude call itself fails (missing key,
// network error, bad response, refusal, empty result) — never as a
// substitute for a working scoping call. Ordered most-specific-first and
// with "skin" dropped from the skincare list entirely, so it can't reproduce
// the old client-side bug where "skin" (from "skincare") matched before
// "sunscreen" was checked and misrouted "sunscreen for beauty creators".
const CATEGORY_KEYWORDS: Record<Category, string[]> = {
  sunscreen: ["sunscreen", "sunblock", "spf"],
  beauty: ["beauty"],
  skincare: ["skincare", "skin care"],
};
const KEYWORD_FALLBACK_ORDER: Category[] = ["sunscreen", "beauty", "skincare"];

function keywordFallback(message: string): ScopedRequest {
  const lower = message.toLowerCase();
  for (const category of KEYWORD_FALLBACK_ORDER) {
    if (CATEGORY_KEYWORDS[category].some((word) => lower.includes(word))) {
      return { category, searchKeywords: DEFAULT_KEYWORDS[category] };
    }
  }
  // Genuinely ambiguous, even by keyword match — Biocostech defaults to
  // sunscreen/skincare, so fall back to sunscreen keywords rather than a
  // generic beauty search.
  return { category: null, searchKeywords: DEFAULT_KEYWORDS.sunscreen };
}
