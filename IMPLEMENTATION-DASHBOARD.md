# IMPLEMENTATION PLAN — Affiliate Finder chat inside the dashboard

Companion to [HANDOFF.md](HANDOFF.md). HANDOFF.md is the *reference* (what exists, what the
constraints are, what not to break). **This file is the ordered build plan** — do the phases in
order, stop at each checkpoint.

**Target:** the Supabase/Drizzle dashboard app (custom cookie auth, Next.js 16, `proxy.ts`).
**Scope:** mount the existing chat, unchanged in behaviour, on the **AI Chat** route.
**Explicitly out of scope:** persistence, chat history, multi-conversation, Drizzle tables for the
chat, shadcn migration of `components/shared/*`, any change to discovery/enrichment logic.

Run every command from the **dashboard repo** root. `SRC` below means this repo
(`marketing-agent`).

---

## Phase 0 — Unblock the build (do this first, it's independent)

The dashboard currently has `app/page.tsx` (create-next-app boilerplate) and `app/(home)/page.tsx`
both resolving to `/`. Next.js rejects the duplicate route, so `next build` fails today — meaning
you cannot verify *anything* you do in later phases until this is gone.

1. Confirm the conflict: `npm run build` and read the duplicate-route error.
2. Delete `app/page.tsx` (the boilerplate one), keeping `app/(home)/page.tsx`.
3. Re-run the build.

**Checkpoint 0:** `npm run build` succeeds on the untouched dashboard. If it fails for some *other*
reason, fix that now too — you want a known-green baseline before adding files.

---

## Phase 1 — Dependencies and env

1. Install:

```bash
npm install @anthropic-ai/sdk lucide-react
```

`lucide-react` may already be present (it's the configured shadcn `iconLibrary`); npm will no-op if
so. `apifyClient.ts` uses plain `fetch`, so there is no Apify SDK to install.

2. Add to the dashboard's runtime env file (wherever `AUTH_SECRET` lives — `.env.local`, not the
   `.env` that `drizzle-kit` reads):

```
ANTHROPIC_API_KEY=
APIFY_TOKEN=
```

3. Add the same two keys, empty, to `.env.example` if the dashboard keeps one.

**Checkpoint 1:** `npm run build` still green. Both keys resolve via `process.env` in a scratch
server component log, or just trust it — every downstream code path has a fallback if they're
missing, so a wrong key surfaces as mock data, not a crash.

---

## Phase 2 — Copy the logic layer (no UI yet)

Copy from `SRC`, preserving paths. These are pure logic + server-only modules; nothing renders yet,
so this phase is a clean typecheck gate.

```
lib/affiliate-finder/types.ts
lib/affiliate-finder/conversationState.ts
lib/affiliate-finder/mockData.ts
lib/affiliate-finder/format.ts
lib/affiliate-finder/discoveryClient.ts
lib/affiliate-finder/apifyClient.ts
lib/affiliate-finder/claudeClient.ts
lib/rateLimit.ts
```

Notes:

- **Do not copy `SRC/lib/utils.ts`.** The dashboard's `cn()` (clsx + tailwind-merge) is
  signature-compatible with the hand-rolled one; imports of `@/lib/utils` resolve to the
  dashboard's version with no edits.
- `discoveryClient.ts`, `apifyClient.ts`, `claudeClient.ts` are **server-only** — they read
  `process.env` and must only ever be imported from route handlers under `app/api/`. Never import
  them from a client component.
- `lib/rateLimit.ts` is a 5-req/min fixed-window in-memory limiter. Keep it in-memory; persisting
  it would violate the no-database constraint for this feature.

**Checkpoint 2:** `npx tsc --noEmit` clean. Nothing is wired up, so this only proves the modules
compile against the dashboard's tsconfig and `@/*` alias.

---

## Phase 3 — API routes

Copy verbatim:

```
app/api/discover/route.ts     # POST { message } → scopeRequest → discoverTopCreators
app/api/enrich/route.ts       # POST { creators } → enrichCreators
```

Then resolve the auth interaction — this is the one genuine integration risk:

1. Read `lib/middleware.ts` and root `proxy.ts`. `updateSession` redirects **every** request whose
   path doesn't start with `/login` or `/auth` and has no valid session. That includes `/api/*`.
2. Check the proxy's `config.matcher`. If it already excludes `/api`, nothing to do.
3. If it doesn't: a logged-in user is still fine (the client `fetch()` is same-origin, so the
   session cookie rides along and the request passes). The only affected case is a session-less
   call, which gets an HTML redirect where the client expects JSON. `AffiliateFinderShell`'s
   `catch` blocks already degrade gracefully, so this is not a crash — but decide deliberately
   whether you want `/api/discover` to 401-as-JSON instead of redirect, and if so add `/api` to the
   matcher exclusion and return a JSON 401 from the route.

**Do not test these routes by calling them.** Both hit the Anthropic API; `/api/discover` also hits
Apify. Every call burns real tokens and credits. The user tests the live path manually.

**Checkpoint 3:** `npm run build` green. Routes appear in the build's route table as dynamic
`ƒ /api/discover` and `ƒ /api/enrich`.

---

## Phase 4 — Design tokens

Do **not** overwrite the dashboard's `app/globals.css`. Instead, diff it against
`SRC/app/globals.css` and confirm the dashboard defines every one of these in **both** `:root` and
`.dark`:

`--background --foreground --card --card-foreground --popover --popover-foreground --primary
--primary-foreground --secondary --secondary-foreground --muted --muted-foreground --accent
--accent-foreground --destructive --border --input --ring --radius`

Then confirm the Tailwind v4 plumbing exists:

- an `@theme inline` block mapping each token to `--color-*` (`--color-card: var(--card)`, …) —
  without it, `bg-card` / `text-muted-foreground` silently emit nothing;
- the `--radius-sm/md/lg/xl/2xl` scale — without it, `rounded-xl` is a no-op;
- `@custom-variant dark (&:is(.dark *))` — both repos use class-based dark mode, so this should
  already match.

Add only what's **missing**, copying the declaration from `SRC/app/globals.css`. Palette
differences are expected and desirable — the dashboard's green/neutral brand tokens re-skin the
chat automatically.

`--destructive` is non-negotiable: the "Not found — needs manual outreach" contact state renders as
`text-destructive` and must stay visibly distinct from ordinary text.

Fonts need no work — no chat component references a font variable directly.

**Checkpoint 4:** nothing to run; this is a read-and-patch phase. It gets verified visually in
Phase 6.

---

## Phase 5 — Copy the UI components

```
components/shared/card.tsx
components/shared/button.tsx
components/shared/checkbox.tsx
components/shared/data-table.tsx

components/affiliate-finder/AffiliateFinderShell.tsx
components/affiliate-finder/ChatThread.tsx
components/affiliate-finder/MessageBubble.tsx
components/affiliate-finder/Composer.tsx
components/affiliate-finder/DiscoveryResultCard.tsx
components/affiliate-finder/EnrichmentSummaryCard.tsx
```

**Do not copy `ThemeToggle.tsx`.** It flips `document.documentElement.classList` from local
component state and would fight the dashboard's own theming.

`components/shared/*` copies as-is. The dashboard is configured for shadcn (`components.json`,
`base-vega`/`neutral`) but has nothing scaffolded under `components/ui/*`; rewriting these four
against shadcn primitives is a **separate future task**, not part of this port. `data-table.tsx` is
the one shared table recipe both cards depend on — replacing it with a hand-rolled `<table>` breaks
the layout.

Then make **exactly these three edits** to `AffiliateFinderShell.tsx`, and nothing else:

1. Delete the `<header>` block (the "Affiliate Finder / TikTok creator discovery · Philippines"
   title row) — the dashboard sidebar and header already provide this chrome.
2. Delete the `ThemeToggle` import and its usage.
3. Change the outer wrapper `flex h-dvh flex-col bg-background` → `flex h-full flex-col
   bg-background`, so it fills the dashboard's content area instead of the viewport.

Everything below the header stays byte-identical: the `overflow-y-auto` scroll region, the
`max-w-6xl` thread column, and the `state.stage === "intake"` composer footer.

**Checkpoint 5:** `npx tsc --noEmit` clean.

---

## Phase 6 — Mount on the AI Chat route

1. Find the route the existing **AI Chat** sidebar item points to, inside the dashboard's route
   group so the sidebar layout wraps it.
2. Replace its contents with a server component that renders the client shell:

```tsx
import { AffiliateFinderShell } from "@/components/affiliate-finder/AffiliateFinderShell";

export default function AiChatPage() {
  return <AffiliateFinderShell />;
}
```

3. Whatever placeholder that route renders today (the centred "How can I help you today?" composer
   with the model picker) is **replaced entirely**. `Composer.tsx` — 500-char hard truncation,
   Enter-to-send, Shift+Enter for newline — is the only discovery entry point and must not be
   swapped for the dashboard's own input control.
4. Make the content area a full-height flex container. If the dashboard's route-group layout
   doesn't already give its children full height, `h-full` collapses and the composer floats
   mid-page instead of pinning to the bottom. Fix it in the **layout**, not by reverting the shell
   to `h-dvh`.

**Checkpoint 6:** `npm run build` && `npm run lint` && `npx tsc --noEmit`, all green. Then hand off
to the user for the manual smoke test — do not drive the live flow yourself.

---

## Phase 7 — Manual smoke test (user-run)

Ask the user to walk the full path once, logged in:

1. Navigate to **AI Chat** — the composer is pinned to the bottom, thread area scrolls
   independently, sidebar and header render normally.
2. Type a request ("looking for sunscreen creators in Manila") → assistant shows a pending bubble →
   a discovery card with **10** creators appears inline.
3. Tick a subset → confirm selection → only the selected creators enrich.
4. Contact table renders; any missing field shows "Not found — needs manual outreach" in the
   destructive colour, never a blank cell.
5. CSV export downloads.
6. Toggle the dashboard's dark mode — the chat follows, no unstyled patches.
7. Reload — the conversation resets to the start. **This is correct**, not a regression.

If discovery returns nothing useful, check the `next dev` terminal *before* assuming a
quality problem: a rejected `output_config.format.schema` 400s on every call, logs loudly as
`[discoveryClient] … failed:`, and fails **silently in the UI** by falling back. See HANDOFF.md §7
for the two specific schema traps.

---

## Risk register

| Risk | Where it bites | Mitigation |
|---|---|---|
| Duplicate `/` route | `next build` fails before you can verify anything | Phase 0, first |
| Proxy gates `/api/*` | session-less calls get HTML where JSON is expected | Phase 3 step 2–3 |
| Missing `@theme inline` mappings | `bg-card`, `rounded-xl` silently no-op; chat looks unstyled | Phase 4 |
| Content area not full-height | composer floats mid-page after `h-dvh` → `h-full` | Phase 6 step 4 |
| `cn()` collision | none — signatures compatible | don't copy `SRC/lib/utils.ts` |
| Accidental live API calls during "verification" | real tokens + Apify credits burned | build/lint/tsc only; user tests manually |
| Someone "cleans up" a fallback | a network failure becomes a broken UI state | HANDOFF.md §6 |

---

## Constraints — restated because they're load-bearing

Full list in HANDOFF.md §6. The ones most likely to be violated while porting:

- **No persistence.** All chat state is one `useReducer`. No localStorage, no cookies, no Drizzle
  table, no Supabase row. A reload wipes it.
- **10-result hard cap**, enforced in `apifyClient.ts` (`MAX_RESULTS_PER_CATEGORY`), not the UI.
- **Contacts are never fabricated** — missing means an explicit not-found state.
- **Enrichment runs only on user-selected creators**, never the full batch. Cost control.
- **Fallbacks never throw**, and always return the live path's shape.
- **Free-text chat is the sole entry point.** No category pills, no separate classifier, no
  web_search discovery path.
- **PH-only scope** on every Apify call.
- `MAX_MESSAGE_LENGTH` (Composer, 500) and `MAX_MESSAGE_CHARS` (discoveryClient, 500) must stay in
  sync.

---

## Definition of done

- [ ] Phase 0 — dashboard builds clean before any port work.
- [ ] Phases 1–6 complete, each checkpoint green.
- [ ] AI Chat route renders the Affiliate Finder chat inside the dashboard shell.
- [ ] No `ThemeToggle`, no second header, no `h-dvh`.
- [ ] `SRC/lib/utils.ts`, `SRC/app/layout.tsx`, `SRC/app/page.tsx`, `SRC/app/globals.css` were
      **not** copied.
- [ ] `npm run build`, `npm run lint`, `npx tsc --noEmit` all clean.
- [ ] User's Phase 7 smoke test passes end to end.
- [ ] Zero new database tables, migrations, or persisted state.
