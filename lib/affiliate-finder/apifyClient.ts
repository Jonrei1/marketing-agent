// Server-only module: reads process.env.APIFY_TOKEN and is only ever imported
// from app/api/discover/route.ts, never from a client component.
import { getMockCandidates } from "./mockData";
import type { Category, CreatorSummary } from "./types";

const APIFY_ACTOR = "clockworks~tiktok-scraper";
const MAX_RESULTS_PER_CATEGORY = 10; // hard cap, do not parameterize this higher
// Apify is now the fallback discovery source (discoveryClient.ts / Claude is
// primary) rather than the first thing tried, so a slow free-tier run no
// longer blocks the chat as directly — but it still must not hang forever.
// 30s (up from the original 8s) balances letting a real run finish against
// never leaving the request pending indefinitely.
const APIFY_TIMEOUT_MS = 30_000;

// Country scope — this demo is Philippines-only. Every hashtag is PH-specific
// (never a bare global tag like "beautytiktok"), the actor's proxy is pinned
// to a PH IP so TikTok serves PH-region results, and any video carrying a
// non-PH location tag is dropped in aggregateByCreator below.
const COUNTRY_CODE = "PH";

const CATEGORY_HASHTAGS: Record<Category, string[]> = {
  beauty: ["beautyph", "phbeauty", "beautytiktokph"],
  skincare: ["skincareph", "phskincare", "skincaretiktokph"],
  sunscreen: ["sunscreenph", "phsunscreen", "spfph"],
};

type ApifyVideo = {
  authorMeta?: {
    name?: string;
    nickName?: string;
    fans?: number;
    region?: string;
  };
  diggCount?: number;
  commentCount?: number;
  shareCount?: number;
  playCount?: number;
  text?: string;
  locationCreated?: string;
};

// Keep a video only if nothing contradicts a PH origin. Fields are optional
// depending on what the actor returns, so this never rejects a video purely
// for missing region data — only for an explicit non-PH region/location.
function isPhilippineScoped(video: ApifyVideo): boolean {
  const region = video.authorMeta?.region;
  if (region && region.toUpperCase() !== COUNTRY_CODE) return false;
  const location = video.locationCreated;
  if (location && location.toUpperCase() !== COUNTRY_CODE) return false;
  return true;
}

function aggregateByCreator(videos: ApifyVideo[], category: Category): CreatorSummary[] {
  const byAuthor = new Map<
    string,
    { videos: ApifyVideo[]; fans: number; name: string; nickName: string | undefined; bio: string }
  >();

  for (const video of videos) {
    const name = video.authorMeta?.name;
    if (!name) continue;
    const entry = byAuthor.get(name) ?? {
      videos: [],
      fans: video.authorMeta?.fans ?? 0,
      name,
      // authorMeta.name is the @handle; nickName is the account's real
      // display name (e.g. "Darwin" vs. handle "makeupstorybydar") — prefer
      // it for displayName instead of just stripping "@" from the handle.
      nickName: video.authorMeta?.nickName,
      bio: video.text ?? "",
    };
    entry.videos.push(video);
    byAuthor.set(name, entry);
  }

  const mockPool = getMockCandidates(category);
  const creators: CreatorSummary[] = [];
  let index = 0;
  for (const [name, entry] of byAuthor) {
    const rates = entry.videos.map((v) => {
      const plays = v.playCount || 1;
      return ((v.diggCount ?? 0) + (v.commentCount ?? 0) + (v.shareCount ?? 0)) / plays;
    });
    const engagementRate = rates.reduce((a, b) => a + b, 0) / (rates.length || 1);
    // GMV/items-sold have no live source (Apify can't see TikTok Shop
    // commerce data) — merge estimates from the mock pool by index.
    const estimate = mockPool[index % mockPool.length];

    creators.push({
      id: `live-${name}`,
      username: `@${name}`,
      displayName: entry.nickName || name,
      profileUrl: `https://www.tiktok.com/@${name}`,
      followers: entry.fans,
      engagementRate: Number(engagementRate.toFixed(3)),
      gmv: estimate.gmv,
      itemsSold: estimate.itemsSold,
      bio: entry.bio,
    });
    index += 1;
  }

  return creators.sort((a, b) => b.followers - a.followers).slice(0, MAX_RESULTS_PER_CATEGORY);
}

export async function discoverTopCreators(category: Category): Promise<CreatorSummary[]> {
  const token = process.env.APIFY_TOKEN;
  if (!token) {
    console.warn("[apifyClient] APIFY_TOKEN not set — using mock discovery data");
    return getMockCandidates(category);
  }

  try {
    const hashtags = CATEGORY_HASHTAGS[category];
    const res = await fetch(
      `https://api.apify.com/v2/acts/${APIFY_ACTOR}/run-sync-get-dataset-items?token=${token}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hashtags,
          resultsPerPage: MAX_RESULTS_PER_CATEGORY,
          // Pins the actor's outbound proxy to a PH IP so TikTok serves
          // PH-region results instead of whatever is globally trending.
          proxyCountryCode: COUNTRY_CODE,
        }),
        ...(APIFY_TIMEOUT_MS ? { signal: AbortSignal.timeout(APIFY_TIMEOUT_MS) } : {}),
      },
    );

    if (!res.ok) {
      const body = await res.text().catch(() => "<unreadable body>");
      throw new Error(`Apify request failed with status ${res.status}: ${body}`);
    }

    const videos = (await res.json()) as ApifyVideo[];
    console.warn(`[apifyClient] Apify returned ${videos.length} raw video(s):`, JSON.stringify(videos.slice(0, 2), null, 2));
    if (!Array.isArray(videos) || videos.length === 0) {
      throw new Error("Apify returned no results");
    }
    // Defensive cutoff — resultsPerPage already asks Apify for 10, but a
    // free-tier actor can ignore that; never process more than a small
    // multiple of the cap.
    const boundedVideos = videos.slice(0, MAX_RESULTS_PER_CATEGORY * 5);
    const phVideos = boundedVideos.filter(isPhilippineScoped);
    console.warn(`[apifyClient] ${phVideos.length}/${boundedVideos.length} videos passed PH-scope filter`);
    if (phVideos.length === 0) throw new Error("no Philippines-scoped results returned");

    const creators = aggregateByCreator(phVideos, category);
    if (creators.length === 0) throw new Error("no creators could be aggregated");
    return creators.slice(0, MAX_RESULTS_PER_CATEGORY);
  } catch (err) {
    console.error("[apifyClient] live discovery failed, falling back to mock data:", err);
    return getMockCandidates(category);
  }
}
