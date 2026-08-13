import type { Category, CreatorSummary } from "./types";

// Deliberately plausible-but-fake PH creator data. GMV/itemsSold are always
// "estimated" — Apify's TikTok scraper has no TikTok Shop visibility, so
// these two fields come from here even on the live discovery path (see
// apifyClient.ts). Bios are written so contact-field enrichment reliably
// surfaces BOTH found and not-found outcomes across a batch.

const BIOS_WITH_CONTACT = (name: string, handle: string, seed: number) => [
  `Hi! ${name} here 🌸 PH-based content creator. For collabs: ${handle}@creatormail.com or Viber 0917-555-01${10 + (seed % 90)}`,
  `${name} | Beauty & lifestyle | Manila 🇵🇭 | Business inquiries: mobile 0928-444-0${10 + (seed % 90)} or email hello.${handle}@gmail.com`,
  `${name} ✨ Skincare enthusiast sharing honest reviews. DM or Viber 0995-321-0${10 + (seed % 90)} for partnerships`,
];

const BIOS_NO_CONTACT = (name: string) => [
  `${name} | just here for the vibes 🌺 no biz stuff pls`,
  `${name} 🇵🇭 content creator | link in profile for more`,
  `${name} • beauty & skincare content • Manila based`,
];

function pick<T>(arr: T[], seed: number): T {
  return arr[seed % arr.length];
}

function makeCreator(
  category: Category,
  index: number,
  hasContact: boolean,
): CreatorSummary {
  const seed = index + 1;
  const name = `${category}.creator${seed}`;
  const displayName = `${category[0].toUpperCase()}${category.slice(1)} Creator ${seed}`;
  const followers = Math.round((50_000 + seed * 37_000 + (seed % 3) * 12_500));
  const engagementRate = Number((0.03 + ((seed * 7) % 12) / 100).toFixed(3));
  const gmv = Math.round((80_000 + seed * 45_000 + (seed % 4) * 30_000));
  const itemsSold = Math.round(gmv / (150 + (seed % 5) * 20));
  const bio = hasContact
    ? pick(BIOS_WITH_CONTACT(displayName, name, seed), seed)
    : pick(BIOS_NO_CONTACT(displayName), seed);

  return {
    id: `${category}-${seed}`,
    username: `@${name}`,
    displayName,
    profileUrl: `https://www.tiktok.com/@${name}`,
    followers,
    engagementRate,
    gmv,
    itemsSold,
    bio,
  };
}

function makeCategorySet(category: Category): CreatorSummary[] {
  // Alternate contact/no-contact so the enrichment demo always shows both
  // the emerald "found" and destructive "not found" status states.
  return Array.from({ length: 10 }, (_, i) =>
    makeCreator(category, i, i % 3 !== 0),
  ).sort((a, b) => b.followers - a.followers);
}

const MOCK_CANDIDATES: Record<Category, CreatorSummary[]> = {
  beauty: makeCategorySet("beauty"),
  skincare: makeCategorySet("skincare"),
  sunscreen: makeCategorySet("sunscreen"),
};

export function getMockCandidates(category: Category): CreatorSummary[] {
  return MOCK_CANDIDATES[category];
}

export function getMockEstimates(id: string): { gmv: number; itemsSold: number } | null {
  for (const list of Object.values(MOCK_CANDIDATES)) {
    const found = list.find((c) => c.id === id);
    if (found) return { gmv: found.gmv, itemsSold: found.itemsSold };
  }
  return null;
}
