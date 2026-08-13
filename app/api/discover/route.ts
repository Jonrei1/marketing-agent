import { NextResponse } from "next/server";
import { discoverTopCreators } from "@/lib/affiliate-finder/apifyClient";
import { classifyCategory, discoverWithClaude } from "@/lib/affiliate-finder/discoveryClient";
import { checkRateLimit, getClientKey } from "@/lib/rateLimit";
import type { Category } from "@/lib/affiliate-finder/types";

export const runtime = "nodejs";

const VALID_CATEGORIES: Category[] = ["beauty", "skincare", "sunscreen"];

// Apify free tier has a small monthly credit balance — keep discovery calls
// infrequent regardless of how the UI is driven.
const DISCOVER_LIMIT = { limit: 5, windowMs: 60_000 }; // 5 requests / minute / client

export async function POST(request: Request) {
  const rate = checkRateLimit(`discover:${getClientKey(request)}`, DISCOVER_LIMIT);
  if (!rate.ok) {
    return NextResponse.json(
      { error: "Too many discovery requests — please wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  const body = (await request.json()) as { category?: string; message?: string };

  let category = body.category as Category | undefined;
  if (!category && typeof body.message === "string" && body.message.trim()) {
    // Server-side classification replaces the old client-side keyword match —
    // fixes the first-match-wins bug ("sunscreen for beauty creators").
    category = (await classifyCategory(body.message)) ?? undefined;
  }

  if (!category || !VALID_CATEGORIES.includes(category)) {
    return NextResponse.json(
      { error: "Which category should I search? Try beauty, skincare, or sunscreen." },
      { status: 400 },
    );
  }

  // Claude (with web search) is the primary discovery source; Apify is the
  // fallback, and Apify itself falls back to mock data internally. Neither
  // discoverWithClaude nor discoverTopCreators ever throws.
  const candidates = (await discoverWithClaude(category)) ?? (await discoverTopCreators(category));
  return NextResponse.json({ category, candidates });
}
