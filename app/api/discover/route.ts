import { NextResponse } from "next/server";
import { discoverTopCreators } from "@/lib/affiliate-finder/apifyClient";
import { scopeRequest } from "@/lib/affiliate-finder/discoveryClient";
import { checkRateLimit, getClientKey } from "@/lib/rateLimit";
import type { Category } from "@/lib/affiliate-finder/types";

export const runtime = "nodejs";

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

  const body = (await request.json()) as { message?: string };
  if (typeof body.message !== "string" || !body.message.trim()) {
    return NextResponse.json({ error: "Tell me what kind of affiliates you're looking for." }, { status: 400 });
  }

  // Claude's only job here is scoping: read the free-text message and turn
  // it into a category + TikTok Shop search keywords. Apify does the actual
  // discovery — it never falls back to Claude for candidates, only to its
  // own hashtag scraper, then mock (see apifyClient.ts).
  const { category, searchKeywords } = await scopeRequest(body.message);
  // Biocostech defaults to sunscreen/skincare when a message is genuinely
  // ambiguous — see discoveryClient.ts's BRAND_CONTEXT — so the route never
  // has to bounce back asking "which category?".
  const resolvedCategory: Category = category ?? "sunscreen";

  const candidates = await discoverTopCreators(resolvedCategory, searchKeywords);
  return NextResponse.json({ category: resolvedCategory, candidates });
}
