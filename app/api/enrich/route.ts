import { NextResponse } from "next/server";
import { enrichCreators } from "@/lib/affiliate-finder/claudeClient";
import { checkRateLimit, getClientKey } from "@/lib/rateLimit";
import type { CreatorSummary } from "@/lib/affiliate-finder/types";

export const runtime = "nodejs";

const MAX_CREATORS_PER_REQUEST = 10; // matches the discovery cap — never enrich more than one full top-10 batch
const ENRICH_LIMIT = { limit: 5, windowMs: 60_000 }; // 5 requests / minute / client

export async function POST(request: Request) {
  const rate = checkRateLimit(`enrich:${getClientKey(request)}`, ENRICH_LIMIT);
  if (!rate.ok) {
    return NextResponse.json(
      { error: "Too many enrichment requests — please wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  const body = (await request.json()) as { creators?: CreatorSummary[] };
  const creators = body.creators;

  if (!Array.isArray(creators) || creators.length === 0) {
    return NextResponse.json({ error: "No creators provided" }, { status: 400 });
  }

  // Hard cap regardless of what the client sends — protects the Anthropic
  // call from an oversized batch.
  const capped = creators.slice(0, MAX_CREATORS_PER_REQUEST);

  const details = await enrichCreators(capped);
  return NextResponse.json({ details });
}
