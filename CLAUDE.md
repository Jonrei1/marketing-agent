# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

```bash
npm run dev      # start dev server (Turbopack, http://localhost:3000)
npm run build    # production build (also runs the TypeScript check)
npm run lint     # eslint (flat config, eslint-config-next)
npm run start    # serve a production build
```

There is no test runner configured in this repo.

**Do not run the dev server or hit `/api/discover` / `/api/enrich` yourself to "verify" a change —
both routes call the Anthropic API (and `/api/discover` can also call Apify) and burn real tokens/
credits on every call. The user tests manually. Verification for Claude Code means `npm run build`
(typecheck) and `npm run lint` — nothing that triggers a live API call.**

## What this is

A single-feature demo app: **TikTok Affiliate Finder**, a chat-style flow at `/affiliate-finder`
(the root `/` redirects there), built for **Biocostech**, a sunscreen/skincare brand selling in the
Philippines. A brand user describes a need in free-text chat, Claude scopes that message down to a
category + TikTok Shop search keywords, Apify scrapes the top 10 creators for that scope (with real
product GMV, not an estimate, where the scraper pipeline succeeds), the user selects a subset via
inline checkboxes, the assistant enriches only the selected creators with contact info, and the
final table can be exported to CSV. Full spec and constraints: `IMPLEMENTATION.md`.

**Hard constraints baked into the design (see `IMPLEMENTATION.md` §1) — do not relax these:**
- No persistence of any kind (no localStorage/cookies/DB). All state lives in one `useReducer` in
  `AffiliateFinderShell.tsx`; a reload wipes it back to the start — that's correct, not a bug.
- Discovery is hard-capped at **10 results**, enforced in `apifyClient.ts` itself, not just the UI.
- Contact fields (email/viber/mobile) are never fabricated — a missing field renders as an explicit
  "Not found — needs manual outreach" state (`text-destructive`), never a blank cell.
- Enrichment only ever runs against creators the user has actually selected, never the full top-10
  batch — this is a deliberate cost-control measure for both Apify and Anthropic API usage.

## Architecture

```
app/affiliate-finder/page.tsx        server component → renders the client shell
components/affiliate-finder/
  AffiliateFinderShell.tsx           "use client" — owns the useReducer + all fetch() calls
  ChatThread.tsx / MessageBubble.tsx conversation rendering
  DiscoveryResultCard.tsx            inline top-10 table + checkboxes (in an assistant message)
  EnrichmentSummaryCard.tsx          final contact table + client-side CSV export
  Composer.tsx / ThemeToggle.tsx     Composer.tsx is the only discovery entry point (free-text chat)
components/shared/                   hand-rolled Card/Button/Checkbox/DataTable — no shadcn/Base UI
  data-table.tsx                     the one shared table recipe; never hand-roll a raw <table> elsewhere
lib/affiliate-finder/
  types.ts                           ConversationStage, ChatMessage union, CreatorSummary/Detail
  conversationState.ts               the reducer — the actual state machine (see below)
  mockData.ts                        deterministic mock creators, used as final fallback data
  discoveryClient.ts                 server-only: Claude scoping — free-text message → category +
                                      TikTok Shop search keywords (no tools, one fast call)
  apifyClient.ts                     server-only: primary TikTok discovery via Apify (real GMV via
                                      a TikTok Shop scraper actor, hashtag scraper as its own
                                      fallback, mock as the final fallback)
  claudeClient.ts                    server-only: bio-parsing enrichment via Anthropic
  format.ts                          number/money formatting (₱, K/M suffixes, tabular-nums)
lib/rateLimit.ts                     in-memory fixed-window limiter shared by both API routes
app/api/discover/route.ts            POST { message } → discoveryClient.scopeRequest (category +
                                      keywords) → apifyClient.discoverTopCreators
app/api/enrich/route.ts              POST { creators } → claudeClient.enrichCreators
```

**Conversation state machine** (`lib/affiliate-finder/conversationState.ts`): stages are
`intake → discovery → selection → enrichment → summary`, driven by a single `useReducer` in
`AffiliateFinderShell.tsx`. Chat messages are a discriminated union (`ChatMessage` in `types.ts`) —
a message's `kind` (`text` / `pending` / `discovery` / `summary`) determines whether it renders as a
plain bubble or an inline card. There's a `NOTICE` action for surfacing transient errors (e.g. a
rate-limit backoff) without disturbing the current stage.

**Server/client split for secrets:** `discoveryClient.ts`, `apifyClient.ts`, and `claudeClient.ts`
read `process.env.ANTHROPIC_API_KEY` / `process.env.APIFY_TOKEN` and are only ever imported from
their respective route handlers under `app/api/` — never from a client component. The client only
ever talks to `/api/discover` and `/api/enrich`.

**Discovery pipeline: Claude scopes, Apify scrapes.** `discoveryClient.scopeRequest` (Anthropic, no
tools, one short call) reads the user's free-text message and returns a category + up to 3 TikTok
Shop search keywords, grounded in a Biocostech brand-context string (sunscreen/skincare, PH market —
see `BRAND_CONTEXT` in that file) so an ambiguous message still scopes sensibly. `app/api/discover/
route.ts` passes that straight to `apifyClient.discoverTopCreators`, which is the actual discovery
engine: a TikTok Shop scraper actor (real product GMV, not an estimate) first, the original
hashtag-based TikTok scraper as its own fallback, and `mockData.ts` as the final fallback. This is
deliberately NOT the old "Claude finds creators via web_search" design — that chained up to 6
web_search + 6 web_fetch tool calls per request and was the main source of slow discovery
turnaround. Claude now does exactly one small, fast, tool-less call per discovery request.

**The UI is free-text chat only.** `Composer.tsx` is the sole entry point to discovery — there is no
category-pill UI. `classifyCategory` (a standalone category-only classifier) has been folded into
`scopeRequest`, which returns both category and keywords from one call. Chat input is truncated at
`MAX_MESSAGE_LENGTH` / `MAX_MESSAGE_CHARS` (500) before it reaches Claude, same as before.

**`output_config.format.schema` is stricter than plain JSON Schema — two concrete pitfalls hit in
this codebase, both 400s on *every* call, not intermittent failures:**
- `maxItems` on an `array`-type schema is rejected ("For 'array' type, property 'maxItems' is not
  supported"). Enforce array-length caps in code (`.slice(...)`) after parsing, never in the schema.
- A field typed `["string", "null"]` with an `enum` listing the string values plus `null` is
  rejected ("Enum value '...' does not match declared type"). Express "one of these strings, or
  null" as `anyOf: [{type: "string", enum: [...]}, {type: "null"}]` instead — see
  `discoveryClient.ts`'s `SCOPE_SCHEMA` for the working pattern.
- Both of the above **fail loudly in the server console** (`[discoveryClient] ... failed:` with the
  raw Anthropic error) but **silently in the UI** — a schema bug here doesn't crash anything, it
  just makes the affected function always return `null`/fall back, which reads as "the feature works
  but Claude apparently isn't finding anything." Always check the terminal running `npm run dev`
  before assuming a discovery/classification quality issue when the real cause could be a rejected
  request.

**Fallback-on-failure is load-bearing, not incidental.** `scopeRequest`,
`apifyClient.discoverTopCreators`, and `claudeClient.enrichCreators` each catch every failure mode
(missing key/token, timeout, bad response, refusal) and fall back to the next link in their chain,
always returning the same shape as the live path — the UI and the audience can't tell which path
ran. When touching any of these, preserve this: never let a network failure surface as a broken UI
state, and never let a fallback function throw.

**Built-in limits/cutoffs** (added deliberately for cost control on free-tier/metered APIs — see git
history for the full rationale):
- `discoveryClient.ts`: messages truncated to `MAX_MESSAGE_CHARS` (500, matches `Composer.tsx`)
  before scoping, `MAX_KEYWORDS = 3` search keywords returned to Apify.
- `apifyClient.ts`: `MAX_RESULTS_PER_CATEGORY = 10` (hard cap on the final creator list),
  `MAX_PRODUCTS_FOR_CREATOR_LOOKUP = 5` (top-GMV products looked up for affiliates per request),
  `APIFY_TIMEOUT_MS = 20_000` (Apify is the primary path now, so this is tighter than before — a
  slow run must not stall the chat), and a Philippines-only scope on every actor call:
  `region`/`proxyCountryCode: "PH"`, PH-specific hashtags in the fallback tier, plus a post-fetch
  `isPhilippineScoped()` filter in that same fallback tier.
- `claudeClient.ts`: bios truncated to 400 chars, batch capped at 10 creators before the prompt is
  built.
- `lib/rateLimit.ts`: 5 requests/minute per client IP on both `/api/discover` and `/api/enrich`,
  fixed-window, in-memory (resets on restart — consistent with the no-persistence constraint).
- `Composer.tsx`: chat input is hard-truncated at `MAX_MESSAGE_LENGTH` (500 chars).

## Design system notes

`IMPLEMENTATION.md` and `UI-HANDOFF.md` were written assuming a `design.md` + `.claude/skills/ui-ux/`
+ `src/components/ui/*` design system that does **not exist in this repo** (it lives in a sibling
`dashboard-sales` project). What was actually ported into `app/globals.css` is just the OKLCH token
layer (`--background`, `--card`, `--primary`, `--muted`, `--border`, `--destructive`, etc., plus a
class-based `.dark` variant) — there is no shadcn, no Base UI, no `sonner`. Components under
`components/shared/` are hand-rolled directly against those tokens. The page layout is a centered
chatbot (`max-w-3xl` thread + composer), not the dashboard-band anatomy `IMPLEMENTATION.md` §4
describes — that anatomy does not apply here.

Path alias: `@/*` maps to the repo root (there is no `src/` directory), e.g. `@/lib/...`,
`@/components/...`.

## Environment

`.env` (see `.env.example`) needs `APIFY_TOKEN` and `ANTHROPIC_API_KEY`. Both are optional in the
sense that every code path has a fallback — the app runs fully without either key, just without
live data. Without `ANTHROPIC_API_KEY`, `scopeRequest` falls back to keyword matching (still returns
a category + default keywords, never blocks the chat). Without `APIFY_TOKEN`, discovery goes
straight to mock data — Apify is the actual discovery engine, so this is the more impactful key of
the two now.
