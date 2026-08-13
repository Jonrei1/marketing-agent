// Server-only module: reads process.env.ANTHROPIC_API_KEY and is only ever
// imported from app/api/discover/route.ts, never from a client component.
//
// This is the primary discovery path — Claude, with the server-side web
// search tool, finds real TikTok creators for a category. apifyClient.ts is
// the fallback (and mockData is apifyClient's own fallback), so the chain a
// discovery request travels is: this module -> Apify -> mock. Every function
// here catches its own failures and returns null so the route can fall
// through cleanly — never throw out of this module.
import Anthropic from "@anthropic-ai/sdk";
import { CATEGORIES } from "./types";
import type { Category, CreatorSummary } from "./types";

const MAX_RESULTS_PER_CATEGORY = 10; // hard cap, mirrors apifyClient — do not parameterize higher
const MAX_MESSAGE_CHARS = 500; // matches Composer.tsx's MAX_MESSAGE_LENGTH

function getClient(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  return new Anthropic({ apiKey });
}

const CREATOR_ITEM_SCHEMA = {
  type: "object",
  properties: {
    username: { type: "string", description: "TikTok @handle, including the @" },
    displayName: {
      type: "string",
      description:
        "The account's real display name — the bold name shown at the top of the profile, " +
        "distinct from the @handle. Example: handle @makeupstorybydar, display name \"Darwin\". " +
        "These are usually different strings; never produce this by stripping \"@\" from the " +
        "username — if you can't confirm the real display name, use the handle without the @ only " +
        "as a last resort.",
    },
    profileUrl: { type: "string", description: "Full TikTok profile URL, e.g. https://www.tiktok.com/@handle" },
    followers: { type: "integer" },
    engagementRate: { type: "number", description: "0 to 1" },
    gmv: {
      type: "integer",
      description:
        "Estimated TikTok Shop GMV in PHP, based on followers/engagement/category norms. Not a scraped figure.",
    },
    itemsSold: { type: "integer", description: "Estimated items sold, same basis as gmv." },
    bio: {
      type: "string",
      description:
        "The creator's TikTok bio, copied verbatim from the profile page — not a paraphrase or " +
        "summary. Include every line exactly as written, especially contact details (email, " +
        "Viber, mobile, other social links) if the bio has them. A later step extracts contact " +
        "info from this exact text, so an approximated or generic bio will cause real contact " +
        "details to be missed even when they're visible on the profile.",
    },
  },
  required: [
    "username",
    "displayName",
    "profileUrl",
    "followers",
    "engagementRate",
    "gmv",
    "itemsSold",
    "bio",
  ],
  additionalProperties: false,
};

// Ask Claude to find real, currently-active Philippines-based TikTok creators
// for a category, using web search plus web fetch. Web search alone only
// returns snippets, not literal page content, which tends to produce a
// paraphrased bio rather than the real one — losing any contact info in it.
// Web fetch lets the model open a profile URL surfaced by search and read
// the actual bio before answering (it can only fetch a URL already present
// in the conversation, which search results satisfy). Results are estimates
// where TikTok doesn't expose exact figures (GMV/items-sold) — framed as
// such in the schema description, same "ESTIMATED" contract as the
// mock/Apify paths.
export async function discoverWithClaude(category: Category): Promise<CreatorSummary[] | null> {
  const client = getClient();
  if (!client) {
    console.warn("[discoveryClient] ANTHROPIC_API_KEY not set — skipping Claude discovery");
    return null;
  }

  try {
    const response = await client.messages.parse({
      model: "claude-sonnet-5",
      max_tokens: 4096,
      tools: [
        { type: "web_search_20260209", name: "web_search", max_uses: 6 },
        { type: "web_fetch_20260209", name: "web_fetch", max_uses: 6 },
      ],
      output_config: {
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            properties: {
              // NOTE: `maxItems` is NOT a supported constraint for
              // output_config.format.schema ("For 'array' type, property
              // 'maxItems' is not supported" — 400 on every call). The cap is
              // enforced below in code instead, via .slice().
              candidates: {
                type: "array",
                items: CREATOR_ITEM_SCHEMA,
              },
            },
            required: ["candidates"],
            additionalProperties: false,
          },
        },
      },
      messages: [
        {
          role: "user",
          content:
            `Find up to ${MAX_RESULTS_PER_CATEGORY} real, currently active TikTok creators based in the ` +
            `Philippines who post ${category} content, ranked by follower count descending. Use web search ` +
            `to confirm each creator is real and PH-based — do not invent handles. Only include creators with ` +
            `an explicit Philippines connection (PH hashtags, PH-based content, Filipino audience) — skip ` +
            `anyone whose region can't be confirmed. For each creator, fetch their TikTok profile page (the ` +
            `web_fetch tool) once you have its URL from search, and copy the bio field verbatim from that ` +
            `page — do not paraphrase or summarize it, and do not skip fetching just because search already ` +
            `gave you a plausible-looking bio. displayName is the creator's real name shown at the top of ` +
            `their profile (e.g. "Darwin"), not their @handle — read it off the fetched profile page rather ` +
            `than deriving it from the username. gmv and itemsSold are your estimates (TikTok Shop commerce ` +
            `data isn't publicly scrapable), reasoned from follower count, engagement rate, and typical PH ` +
            `creator-commerce rates for this category — do not fabricate a scraped-looking figure.`,
        },
      ],
    });

    if (response.stop_reason === "refusal") {
      console.warn("[discoveryClient] Claude discovery refused");
      return null;
    }

    const parsed = response.parsed_output as { candidates: Array<Omit<CreatorSummary, "id">> } | null;
    if (!parsed || !Array.isArray(parsed.candidates) || parsed.candidates.length === 0) {
      console.warn("[discoveryClient] Claude discovery returned no candidates");
      return null;
    }

    return parsed.candidates.slice(0, MAX_RESULTS_PER_CATEGORY).map((c, index) => ({
      id: `claude-${category}-${index}`,
      ...c,
    }));
  } catch (err) {
    console.warn("[discoveryClient] live discovery failed, falling back:", err);
    return null;
  }
}

// NOTE: a `type: ["string", "null"]` field with `enum: [...CATEGORIES, null]`
// is rejected by output_config.format.schema ("Enum value 'beauty' does not
// match declared type" — 400 on every call, structured-outputs schemas are
// stricter here than plain JSON Schema). `anyOf` with a plain string enum +
// a separate null branch is the supported way to express "one of these
// strings, or null".
const CATEGORY_CLASSIFY_SCHEMA = {
  type: "object",
  properties: {
    category: {
      anyOf: [{ type: "string", enum: CATEGORIES }, { type: "null" }],
      description: "The matched category, or null if the message doesn't clearly name one.",
    },
  },
  required: ["category"],
  additionalProperties: false,
};

// Keyword fallback used only when the Claude classification call itself fails
// (missing key, network error, bad response) — never as a substitute for a
// working classifier. Ordered most-specific-first and with "skin" dropped
// from the skincare list entirely, so it can't reproduce the old client-side
// bug where "skin" (from "skincare") matched before "sunscreen" was checked
// and misrouted "sunscreen for beauty creators" / "skin-friendly sunscreen".
const CATEGORY_KEYWORDS: Record<Category, string[]> = {
  sunscreen: ["sunscreen", "sunblock", "spf"],
  beauty: ["beauty"],
  skincare: ["skincare", "skin care"],
};
const KEYWORD_FALLBACK_ORDER: Category[] = ["sunscreen", "beauty", "skincare"];

function keywordFallbackCategory(message: string): Category | null {
  const lower = message.toLowerCase();
  for (const category of KEYWORD_FALLBACK_ORDER) {
    if (CATEGORY_KEYWORDS[category].some((word) => lower.includes(word))) return category;
  }
  return null;
}

// Replaces the old client-side keyword substring-match as the *primary* path
// (which had a first-match-wins bug: "sunscreen for beauty creators" resolved
// to "beauty"). Falls back to keywordFallbackCategory whenever the Claude
// call itself fails or errors, so an API/model problem degrades to "best
// effort" instead of permanently blocking every free-text message behind the
// "which category?" prompt — a call that failed and a message that genuinely
// names no category must not look identical to the caller.
export async function classifyCategory(message: string): Promise<Category | null> {
  const client = getClient();
  const truncated =
    message.length > MAX_MESSAGE_CHARS ? message.slice(0, MAX_MESSAGE_CHARS) : message;

  if (!client) {
    console.warn(
      "[discoveryClient] ANTHROPIC_API_KEY not set — using keyword fallback for classification",
    );
    return keywordFallbackCategory(message);
  }

  try {
    const response = await client.messages.parse({
      model: "claude-sonnet-5",
      max_tokens: 256,
      output_config: { format: { type: "json_schema", schema: CATEGORY_CLASSIFY_SCHEMA } },
      messages: [
        {
          role: "user",
          content:
            `Which product category, if any, does this message ask about — beauty, skincare, or ` +
            `sunscreen? If it names more than one, or none clearly, return null.\n\nMessage: "${truncated}"`,
        },
      ],
    });

    if (response.stop_reason === "refusal") {
      console.warn("[discoveryClient] category classification refused — using keyword fallback");
      return keywordFallbackCategory(message);
    }
    const parsed = response.parsed_output as { category: Category | null } | null;
    if (!parsed || !parsed.category || !CATEGORIES.includes(parsed.category)) {
      // Claude explicitly found no category — trust that over the keyword
      // fallback for a live, successful call; only errors/no-key/refusal
      // above fall back to keywords.
      return null;
    }
    return parsed.category;
  } catch (err) {
    console.warn(
      "[discoveryClient] category classification failed, using keyword fallback:",
      err,
    );
    return keywordFallbackCategory(message);
  }
}
