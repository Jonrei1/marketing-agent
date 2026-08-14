// Server-only module: reads process.env.APIFY_TOKEN and is only ever imported
// from app/api/discover/route.ts, never from a client component.
//
// This is now the primary discovery engine (Claude's discoveryClient.ts only
// scopes the request into search keywords — see that file's header). The
// pipeline here is two Apify actors chained, then mock as the final
// fallback:
//   1. SHOP_ACTOR, mode "shop_search" — real TikTok Shop products for the
//      scoped keywords, PH region. Product price × sold count is a REAL GMV
//      figure (not an estimate) for the top-selling products in category.
//   2. SHOP_ACTOR, mode "creator_showcase" — the affiliate creators actually
//      showcasing those top products, attributing each product's GMV across
//      the creators who showcase it (an approximation — TikTok doesn't
//      expose a public per-creator GMV split, so this is the closest
//      derivable figure from real sold/price data rather than a guess).
//   3. PROFILE_ACTOR (the original clockworks TikTok scraper) — follower
//      count and bio for the discovered creator handles, used for ranking
//      and downstream contact-info enrichment.
// Field names for steps 1-2 are taken from the actor's public store listing;
// this repo never calls a live API to "verify" changes (see CLAUDE.md), so
// if the actor's actual response shape drifts, this fails closed into the
// hashtag-based fallback below rather than into a broken UI state.
import { getMockCandidates } from "./mockData";
import type { Category, CreatorSummary } from "./types";

const SHOP_ACTOR = "unseenuser~tiktok-shop-scraper";
const PROFILE_ACTOR = "clockworks~tiktok-scraper";
const MAX_RESULTS_PER_CATEGORY = 10; // hard cap, do not parameterize this higher
const MAX_PRODUCTS_FOR_CREATOR_LOOKUP = 5; // how many top-GMV products to pull affiliates for
const COUNTRY_CODE = "PH";

type ShopProduct = {
  productId?: string;
  productUrl?: string;
  productTitle?: string;
  // Actor may expose price as a string ("₱499") or number depending on
  // version — parsePrice below handles either.
  productPrice?: string | number;
  soldCount?: number;
  sold?: number;
  salesCount?: number;
};

type CreatorShowcase = {
  username?: string;
  productUrl?: string;
  productId?: string;
  commissionRate?: string | number;
};

type ApifyProfileVideo = {
  authorMeta?: {
    name?: string;
    nickName?: string;
    fans?: number;
  };
  diggCount?: number;
  commentCount?: number;
  shareCount?: number;
  playCount?: number;
  text?: string;
};

async function runApifyActor<T>(actor: string, input: Record<string, unknown>, token: string): Promise<T[]> {
  const res = await fetch(
    `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${token}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "<unreadable body>");
    throw new Error(`Apify actor ${actor} failed with status ${res.status}: ${body}`);
  }
  const items = (await res.json()) as T[];
  if (!Array.isArray(items)) throw new Error(`Apify actor ${actor} returned a non-array response`);
  return items;
}

function parsePrice(price: string | number | undefined): number {
  if (typeof price === "number") return price;
  if (!price) return 0;
  const n = Number(price.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function parseSold(product: ShopProduct): number {
  return product.soldCount ?? product.sold ?? product.salesCount ?? 0;
}

// Real-GMV discovery path: shop_search for top products by category keyword,
// creator_showcase for who's promoting them, then a profile lookup for
// follower/bio data.
async function discoverViaShopScraper(
  category: Category,
  keywords: string[],
  token: string,
): Promise<CreatorSummary[]> {
  const products = await runApifyActor<ShopProduct>(
    SHOP_ACTOR,
    {
      mode: "shop_search",
      searchKeywords: keywords,
      region: COUNTRY_CODE,
      maxResults: MAX_RESULTS_PER_CATEGORY * 3,
    },
    token,
  );
  if (products.length === 0) throw new Error("shop_search returned no products");

  const productsWithGmv = products
    .filter((p) => p.productUrl)
    .map((p) => ({ ...p, gmv: Math.round(parsePrice(p.productPrice) * parseSold(p)) }))
    .sort((a, b) => b.gmv - a.gmv)
    .slice(0, MAX_PRODUCTS_FOR_CREATOR_LOOKUP);
  if (productsWithGmv.length === 0) throw new Error("no products with a resolvable URL");

  const productUrls = productsWithGmv.map((p) => p.productUrl as string);
  const gmvByProductUrl = new Map(productsWithGmv.map((p) => [p.productUrl as string, p.gmv]));
  const priceByProductUrl = new Map(productsWithGmv.map((p) => [p.productUrl as string, parsePrice(p.productPrice)]));

  const showcases = await runApifyActor<CreatorShowcase>(
    SHOP_ACTOR,
    {
      mode: "creator_showcase",
      productUrls,
      region: COUNTRY_CODE,
      maxResults: MAX_RESULTS_PER_CATEGORY * 3,
    },
    token,
  );
  if (showcases.length === 0) throw new Error("creator_showcase returned no affiliates");

  // How many creators showcase each product, so a product's real GMV can be
  // split across them — a straight average attribution, not a guess at any
  // individual creator's true share (TikTok doesn't expose that publicly).
  const creatorsPerProduct = new Map<string, number>();
  for (const s of showcases) {
    if (!s.productUrl) continue;
    creatorsPerProduct.set(s.productUrl, (creatorsPerProduct.get(s.productUrl) ?? 0) + 1);
  }

  const attributedGmv = new Map<string, number>();
  const attributedItems = new Map<string, number>();
  for (const s of showcases) {
    if (!s.username || !s.productUrl) continue;
    const productGmv = gmvByProductUrl.get(s.productUrl) ?? 0;
    const productPrice = priceByProductUrl.get(s.productUrl) ?? 0;
    const splitCount = creatorsPerProduct.get(s.productUrl) ?? 1;
    const share = productGmv / splitCount;
    attributedGmv.set(s.username, (attributedGmv.get(s.username) ?? 0) + share);
    if (productPrice > 0) {
      attributedItems.set(s.username, (attributedItems.get(s.username) ?? 0) + share / productPrice);
    }
  }
  if (attributedGmv.size === 0) throw new Error("no creator/product pairs to attribute GMV to");

  const usernames = [...attributedGmv.keys()]
    .sort((a, b) => (attributedGmv.get(b) ?? 0) - (attributedGmv.get(a) ?? 0))
    .slice(0, MAX_RESULTS_PER_CATEGORY);

  const profiles = await runApifyActor<ApifyProfileVideo>(
    PROFILE_ACTOR,
    { profiles: usernames, resultsPerPage: 3, proxyCountryCode: COUNTRY_CODE },
    token,
  );

  const profileByUsername = new Map<string, ApifyProfileVideo[]>();
  for (const video of profiles) {
    const name = video.authorMeta?.name;
    if (!name) continue;
    const list = profileByUsername.get(name) ?? [];
    list.push(video);
    profileByUsername.set(name, list);
  }

  const creators: CreatorSummary[] = usernames.map((name) => {
    const videos = profileByUsername.get(name) ?? [];
    const rates = videos.map((v) => {
      const plays = v.playCount || 1;
      return ((v.diggCount ?? 0) + (v.commentCount ?? 0) + (v.shareCount ?? 0)) / plays;
    });
    const engagementRate = rates.length ? Number((rates.reduce((a, b) => a + b, 0) / rates.length).toFixed(3)) : 0;
    const gmv = Math.round(attributedGmv.get(name) ?? 0);
    const itemsSold = Math.round(attributedItems.get(name) ?? 0);

    return {
      id: `shop-${name}`,
      username: `@${name}`,
      displayName: videos[0]?.authorMeta?.nickName || name,
      profileUrl: `https://www.tiktok.com/@${name}`,
      followers: videos[0]?.authorMeta?.fans ?? 0,
      engagementRate,
      gmv,
      itemsSold,
      bio: videos[0]?.text ?? "",
    };
  });

  return creators.sort((a, b) => b.gmv - a.gmv).slice(0, MAX_RESULTS_PER_CATEGORY);
}

// --- Fallback tier: the original hashtag-based discovery, kept as a
// cost-free-tier-safe backstop for when the shop-scraper pipeline above
// fails (missing token, actor error, empty results at any stage). GMV/items
// here are still estimates merged in from mockData, same as before this
// rework — only the shop-scraper path above returns a real GMV figure.
const CATEGORY_HASHTAGS: Record<Category, string[]> = {
  beauty: ["beautyph", "phbeauty", "beautytiktokph"],
  skincare: ["skincareph", "phskincare", "skincaretiktokph"],
  sunscreen: ["sunscreenph", "phsunscreen", "spfph"],
};

type ApifyVideo = ApifyProfileVideo & { locationCreated?: string; authorMeta?: ApifyProfileVideo["authorMeta"] & { region?: string } };

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

async function discoverViaHashtags(category: Category, token: string): Promise<CreatorSummary[]> {
  const hashtags = CATEGORY_HASHTAGS[category];
  const videos = await runApifyActor<ApifyVideo>(
    PROFILE_ACTOR,
    { hashtags, resultsPerPage: MAX_RESULTS_PER_CATEGORY, proxyCountryCode: COUNTRY_CODE },
    token,
  );
  if (videos.length === 0) throw new Error("hashtag discovery returned no results");

  const boundedVideos = videos.slice(0, MAX_RESULTS_PER_CATEGORY * 5);
  const phVideos = boundedVideos.filter(isPhilippineScoped);
  if (phVideos.length === 0) throw new Error("no Philippines-scoped results returned");

  const creators = aggregateByCreator(phVideos, category);
  if (creators.length === 0) throw new Error("no creators could be aggregated");
  return creators.slice(0, MAX_RESULTS_PER_CATEGORY);
}

// Entry point used by app/api/discover/route.ts. Never throws — falls
// through shop-scraper -> hashtag scraper -> mock, always the same shape.
export async function discoverTopCreators(category: Category, keywords: string[]): Promise<CreatorSummary[]> {
  const token = process.env.APIFY_TOKEN;
  if (!token) {
    console.warn("[apifyClient] APIFY_TOKEN not set — using mock discovery data");
    return getMockCandidates(category);
  }

  try {
    return await discoverViaShopScraper(category, keywords, token);
  } catch (err) {
    console.warn("[apifyClient] shop-scraper discovery failed, falling back to hashtag scraper:", err);
  }

  try {
    return await discoverViaHashtags(category, token);
  } catch (err) {
    console.error("[apifyClient] hashtag discovery also failed, falling back to mock data:", err);
    return getMockCandidates(category);
  }
}
