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
(the root `/` redirects there). A brand user describes a need in chat, the assistant discovers the
top 10 TikTok creators for a category (beauty/skincare/sunscreen), the user selects a subset via
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
  CategoryPillGroup.tsx / ThemeToggle.tsx
components/shared/                   hand-rolled Card/Button/Checkbox/DataTable — no shadcn/Base UI
  data-table.tsx                     the one shared table recipe; never hand-roll a raw <table> elsewhere
lib/affiliate-finder/
  types.ts                           ConversationStage, ChatMessage union, CreatorSummary/Detail
  conversationState.ts               the reducer — the actual state machine (see below)
  mockData.ts                        deterministic mock creators, used as final fallback data
  discoveryClient.ts                 server-only: primary TikTok discovery + category
                                      classification via Anthropic (web_search tool)
  apifyClient.ts                     server-only: fallback TikTok discovery via Apify
  claudeClient.ts                    server-only: bio-parsing enrichment via Anthropic
  format.ts                          number/money formatting (₱, K/M suffixes, tabular-nums)
lib/rateLimit.ts                     in-memory fixed-window limiter shared by both API routes
app/api/discover/route.ts            POST { category } (or { message }, unused by the current UI
                                      but still supported) → discoveryClient.discoverWithClaude,
                                      falling back to apifyClient.discoverTopCreators
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

**Discovery fallback chain: Claude → Apify → mock.** `discoveryClient.discoverWithClaude` (Anthropic,
with the server-side `web_search_20260209` + `web_fetch_20260209` tools) is tried first from
`app/api/discover/route.ts`; only when it returns `null` (missing key, refusal, empty result, any
thrown error) does the route fall through to `apifyClient.discoverTopCreators`, which has its own
internal fallback to `mockData.ts`. This is the reverse of the original Apify-first design — Claude
is now the primary discovery engine and Apify exists only as a cost-free-tier-safe backstop.

**The UI is pill-only — free-text chat was tried and reverted.** `CategoryPillGroup.tsx` sends
`{ category }` directly (already resolved, no server-side classification needed); this is
deliberate. A free-text entry point (`{ message }` → `discoveryClient.classifyCategory`) was built
to fix a client-side keyword-match bug (`"sunscreen for beauty creators"` resolving to `"beauty"`),
but classification depended on an `output_config.format.schema` shape that the Anthropic API
rejected on every single call (see the schema pitfalls below) — so every free-text message was
silently falling through discovery's whole chain to mock data, which is worse than the bug it was
meant to fix. The route still accepts `{ message }` and `classifyCategory` is still correct/fixed,
but nothing in the UI calls it right now. Don't re-add free-text chat without first confirming
`classifyCategory` actually returns a category end-to-end (not just that it stops throwing).

**`output_config.format.schema` is stricter than plain JSON Schema — two concrete pitfalls hit in
this codebase, both 400s on *every* call, not intermittent failures:**
- `maxItems` on an `array`-type schema is rejected ("For 'array' type, property 'maxItems' is not
  supported"). Enforce array-length caps in code (`.slice(...)`) after parsing, never in the schema.
- A field typed `["string", "null"]` with an `enum` listing the string values plus `null` is
  rejected ("Enum value '...' does not match declared type"). Express "one of these strings, or
  null" as `anyOf: [{type: "string", enum: [...]}, {type: "null"}]` instead — see
  `discoveryClient.ts`'s `CATEGORY_CLASSIFY_SCHEMA` for the working pattern.
- Both of the above **fail loudly in the server console** (`[discoveryClient] ... failed:` with the
  raw Anthropic error) but **silently in the UI** — a schema bug here doesn't crash anything, it
  just makes the affected function always return `null`/fall back, which reads as "the feature works
  but Claude apparently isn't finding anything." Always check the terminal running `npm run dev`
  before assuming a discovery/classification quality issue when the real cause could be a rejected
  request.

**Fallback-on-failure is load-bearing, not incidental.** `discoverWithClaude`,
`apifyClient.discoverTopCreators`, and `claudeClient.enrichCreators` each catch every failure mode
(missing key, timeout, bad response, refusal) and fall back to the next link in their chain, always
returning the same shape as the live path — the UI and the audience can't tell which path ran. When
touching any of these, preserve this: never let a network failure surface as a broken UI state, and
never let a fallback function throw.

**Built-in limits/cutoffs** (added deliberately for cost control on free-tier/metered APIs — see git
history for the full rationale):
- `discoveryClient.ts`: `MAX_RESULTS_PER_CATEGORY = 10` (same cap as Apify, enforced independently),
  `max_uses: 6` on the web_search tool per discovery call, messages truncated to `MAX_MESSAGE_CHARS`
  (500, matches `Composer.tsx`) before classification.
- `apifyClient.ts`: `MAX_RESULTS_PER_CATEGORY = 10`, `APIFY_TIMEOUT_MS = 30_000` (Apify is now the
  fallback path rather than the first thing tried, so a slower bound is acceptable — still bounded
  because a hung fallback request must not hang the chat indefinitely), response bounded to 5× the
  cap before aggregation, and a Philippines-only scope: `proxyCountryCode: "PH"`, PH-specific
  hashtags only, plus a post-fetch `isPhilippineScoped()` filter that drops any video with an
  explicit non-PH region/location tag.
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
sense that every code path has a mock/regex fallback — the app runs fully without either key, just
without live data. `ANTHROPIC_API_KEY` is now load-bearing for more of the app than just
enrichment: without it, discovery skips straight to Apify (or mock, if `APIFY_TOKEN` is also unset)
and free-text category classification always falls through to the "which category?" prompt.
