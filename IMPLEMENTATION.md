# Implementation Plan — TikTok Affiliate Finder (Chat Demo)

**Audience:** an agentic coding AI (e.g. Claude Code) implementing this end-to-end.
**Goal:** a presentation-ready demo, not a production system. Read this whole
document before writing any code — the constraints in §1 change how almost
every later section should be built.

---

## 1. Constraints (read first, these override default instincts)

- **No database, no persistence.** Everything lives in React state for the
  current session only. A page reload wipes all progress back to the start
  of the chat. Do not add localStorage, sessionStorage, cookies, or any
  backend datastore. This is intentional, not a shortcut to fix later.
- **Top 10, not top 100.** Every "discovery" result set is capped at 10
  items per category, not the 100/1000 discussed in earlier planning. This
  is purely to conserve Apify free-tier credits during repeated demo runs —
  do not build pagination or "load more" for discovery; 10 is the ceiling,
  full stop.
- **Presentation-first.** Optimize for "looks convincing and works reliably
  live," not for scale, error-recovery exhaustiveness, or edge cases beyond
  what's listed in §6. Mock data is an acceptable fallback if a live API
  call fails during the demo (see §5.4).
- **Follow `design.md` exactly.** This is not a generic chat UI — every
  color, spacing, typography, and component choice must trace back to a
  token or recipe in `design.md`. Where this plan and `design.md` conflict,
  `design.md` wins. Where `design.md` doesn't cover a chat-specific pattern
  (e.g. message bubbles), extend its existing tokens rather than inventing
  new hex values or ad-hoc Tailwind classes.
- **Contact fields (email/viber/mobile) are never fabricated.** If a source
  doesn't have the data, the UI shows an explicit "not found" state (styled
  with the status trio's "bad" color per `design.md` §2), never a blank
  cell that could be misread as "not yet loaded."

---

## 2. What this demo proves

A brand user has a chat-style conversation that walks through:

```
1. User describes the need ("top affiliates for 9.9 event, skincare")
2. Assistant shows top 10 ranked candidates for the requested category
3. User selects a subset (checkboxes inline in the chat)
4. Assistant enriches ONLY the selected creators (contact fields)
5. Assistant renders a final summary table + offers a CSV export
```

This validates the reasoning/UX pattern for stakeholders before investing in
the real data-source integrations (Apify production tier, Kalodata paid
tier, TikTok Shop Partner API) discussed elsewhere.

---

## 3. Tech stack (per design.md's stack rules)

- Next.js (App Router), TypeScript
- Tailwind v4 CSS-first, tokens only — no raw hex, no raw Tailwind palette
  classes (see `design.md` §2)
- Base UI (not Radix) for any headless primitives — confirm against
  `.claude/skills/ui-ux/SKILL.md` before adding any new primitive
- shadcn `<Button>`, `<Card>`, `<Dialog>` per `design.md` §4
- lucide-react icons only, `h-4 w-4 shrink-0`
- sonner for toasts (e.g. "Copied to clipboard", "Export ready")
- No new npm packages beyond what's needed for CSV export (confirm nothing
  equivalent already exists in the repo before adding one)

---

## 4. Page anatomy (mapped to design.md §1)

This is a chat interface, not a dashboard page, so the standard band list
doesn't apply verbatim. Map it as follows:

```
┌──────────────────────────────────────────────┐
│ Page header      "Affiliate Finder" + subtitle│  ← design.md §4 Page header recipe, verbatim
│ Chat thread       scrollable message list      │  ← new pattern, built from tokens (see §5.2)
│ Composer          input + send button          │  ← styled like design.md's Search input recipe
└──────────────────────────────────────────────┘
```

Wrapper: `<div className="flex flex-col gap-6 p-6 h-full">` — same `p-6` +
`gap-6` rule as every other page (§1 of design.md). The chat thread is the
one scrollable region (`flex-1 overflow-y-auto`); header and composer stay
fixed.

---

## 5. Component structure

```
/app/affiliate-finder/
  page.tsx                          — server component, renders the client shell

/components/affiliate-finder/
  AffiliateFinderShell.tsx          — "use client", owns all state, no fetching in page.tsx tree
  ChatThread.tsx                    — scrollable message list
  MessageBubble.tsx                 — one turn (user or assistant)
  DiscoveryResultCard.tsx           — inline table of top-10 candidates (Card + table recipe)
  SelectionCheckbox.tsx             — per-row checkbox inside DiscoveryResultCard
  EnrichmentSummaryCard.tsx         — final detail table (Card + table recipe, status trio for gaps)
  Composer.tsx                      — text input + send button
  CategoryPillGroup.tsx             — category chips (beauty/skincare/sunscreen), filter-pill recipe

/lib/affiliate-finder/
  types.ts                         — same CreatorSummary/CreatorDetail shapes as the pipeline already built
  conversationState.ts             — the state machine (see §5.1)
  mockData.ts                      — fallback data if live calls fail mid-demo (see §5.4)
  apifyClient.ts                   — thin wrapper around Apify run-sync endpoint, capped at 10 results
  claudeClient.ts                  — thin wrapper around Anthropic Messages API for bio-parsing + summarizing
```

### 5.1 Conversation state machine

Reuse the same five states from earlier planning, unchanged in shape:

```typescript
type ConversationStage =
  | "intake"       // waiting for the brand to describe their need
  | "discovery"    // showing top-10 ranked candidates for a category
  | "selection"    // user is checking boxes on the discovery result
  | "enrichment"   // fetching/parsing contact fields for selected only
  | "summary";     // final table + export offered
```

Store this plus all message history and result sets in a single
`useReducer` in `AffiliateFinderShell.tsx`. No context provider needed at
this scale — one component owns everything, children are props-driven.

On page reload, this all vanishes — that's correct behavior per §1, not a
bug to fix.

### 5.2 Chat visual pattern (extending design.md tokens)

`design.md` has no message-bubble recipe since it's a dashboard system —
build one that stays inside its token set:

```tsx
// User message
<div className="flex justify-end">
  <div className="max-w-[80%] rounded-xl bg-primary/15 text-foreground px-4 py-2.5 text-sm">
    {content}
  </div>
</div>

// Assistant message
<div className="flex justify-start">
  <div className="max-w-[80%] rounded-xl bg-card border border-border px-4 py-2.5 text-sm text-foreground">
    {content}
  </div>
</div>
```

This uses only tokens already sanctioned in `design.md` §2 (`bg-primary/15`,
`bg-card`, `border-border`, `text-foreground`) — no new colors introduced.

### 5.3 Discovery result card (inline in chat)

This is the one place a full table recipe (`design.md` §4 Detail tables)
belongs inside a chat bubble. Render it as a `<Card>` embedded in the
assistant's message, not as a separate page:

- Card header: `"Top 10 — {category}"` using the Card/table title style
  (`text-base font-medium text-muted-foreground`)
- Table columns: Username, Followers, Engagement Rate, GMV, Items Sold,
  select checkbox
- Row styling exactly per `design.md` §4 table recipe (`border-border/40`,
  `hover:bg-muted/40`, numerics `text-right tabular-nums`)
- No pagination — this is capped at 10 rows, so the pager footer never
  appears (`totalPages` is always 1)
- "Confirm selection" button uses the sanctioned solid-primary button
  style, placed in the Card footer

### 5.4 Data source strategy (respecting free-tier limits)

For the presentation, wire discovery to a **live Apify call capped at
`resultsPerPage: 10`**, so each demo run costs a negligible fraction of the
free credit balance. Specifically:

```typescript
// apifyClient.ts
const APIFY_ACTOR = "clockworks~tiktok-scraper";
const MAX_RESULTS_PER_CATEGORY = 10; // hard cap, do not parameterize this higher

export async function discoverTopCreators(category: Category) {
  // POST to run-sync-get-dataset-items with resultsPerPage: 10
  // aggregate video-level results into one row per creator (see earlier
  // conversation on Apify's one-row-per-video shape)
  // fall back to mockData.ts if the call throws or returns empty
}
```

- **GMV and items sold**: Apify's TikTok scraper has no visibility into
  TikTok Shop commerce data (confirmed earlier). For this demo, populate
  these two fields from `mockData.ts` with clearly plausible but fake
  numbers — do not present them as live in the UI copy ("estimated" label
  on the column header is enough; don't claim these came from the same
  live call as followers).
- **Email/Viber/mobile**: only ever populated via the Claude bio-parsing
  step (`claudeClient.ts`), and only for creators the user has actually
  selected — never run this step against the full top-10 list, to avoid
  burning API calls on candidates that don't get chosen.
- **If the live Apify call fails during a live demo** (rate limit, network,
  whatever): catch the error, fall back silently to `mockData.ts`, and
  continue the conversation normally. A demo that visibly errors out is
  worse than one that quietly uses realistic canned data — but the fallback
  path must produce output structurally identical to the live path, so the
  audience can't tell which one is running.

### 5.5 Enrichment + gap flagging (status trio)

Reuse `design.md`'s status trio for the same purpose as before, but now
through its actual sanctioned tokens instead of hand-rolled red/green:

- Found (email/viber/mobile present) → `text-emerald-500`
- Not found → `text-destructive`, with cell text "Not found — needs manual outreach"

No "warn/yellow" state needed here — this is a binary found/not-found
condition per field.

---

## 6. Build sequence (do these in order)

1. Scaffold `AffiliateFinderShell.tsx` with the reducer and static mock
   conversation (no API calls yet) — confirm the chat UI itself looks right
   against `design.md` before wiring any data source.
2. Build `DiscoveryResultCard.tsx` and `EnrichmentSummaryCard.tsx` against
   `mockData.ts` only — confirm table styling matches `design.md` §4 exactly.
3. Wire `apifyClient.ts` for live discovery, capped at 10 results, with the
   mock fallback from step 2 already in place as the safety net.
4. Wire `claudeClient.ts` for bio-parsing on selection only.
5. Add CSV export on the final summary card (client-side only — generate
   and trigger a browser download, no server round-trip, no file storage).
6. Full run-through: intake → discovery → selection → enrichment → summary,
   in both light and dark mode (per `design.md` §6 checklist).

---

## 7. Explicitly out of scope for this demo

- Any persistence (§1)
- Pagination beyond 10 results
- TikTok Shop Partner API integration (still pending your credentials)
- Kalodata live integration (still on free trial, dashboard-only)
- Real GMV/items-sold data (mocked, clearly not live)
- Multi-category discovery in a single turn (one category per discovery
  round, matching the original stated workflow)
- Authentication/authorization — this is a single-user local demo

---

## 8. New-page checklist (per design.md §8, adapted)

- [ ] Wrapper `flex flex-col gap-6 p-6 h-full`
- [ ] Header recipe: `text-xl` h1 + `text-sm text-muted-foreground` subtitle
- [ ] Server page → client shell split (no fetching in `page.tsx`'s tree)
- [ ] Tokens only; status trio for contact-field gaps; checked in light **and** `.dark`
- [ ] Table recipe from §4 reused verbatim inside chat cards — no new table variant
- [ ] Numbers `tabular-nums`; money `₱X.XM` for GMV
- [ ] Icons lucide `h-4 w-4`
- [ ] Hard cap of 10 results enforced in `apifyClient.ts`, not just in the UI layer
- [ ] Mock-data fallback verified by manually forcing an Apify error and
      confirming the demo continues without visible breakage