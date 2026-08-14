# HANDOFF — Porting the Affiliate Finder chat into the dashboard app

**Goal:** move the TikTok Affiliate Finder chat interface out of this standalone demo
(`marketing-agent`) and into the existing Supabase/Drizzle dashboard app, mounted behind the
dashboard's sidebar (the **AI Chat** nav item). **Nothing about the chat's behaviour changes.**
Still no database, still no persistence — the conversation lives in one `useReducer` and a reload
wipes it. That is correct, not a bug.

This document is written for a Claude Code session running **in the dashboard repo**, with this
repo available to copy from.

---

## 0. TL;DR of the move

| | Source (this repo) | Target (dashboard repo) |
|---|---|---|
| Route | `/affiliate-finder` (root `/` redirects to it) | the existing **AI Chat** route in the dashboard shell |
| Page chrome | own `<header>` + `ThemeToggle`, `h-dvh` | dashboard sidebar + header already provide this — **drop the shell's header** |
| API | `app/api/discover`, `app/api/enrich` | same paths, copied verbatim |
| Secrets | `ANTHROPIC_API_KEY`, `APIFY_TOKEN` | add both to the dashboard's env |
| State | `useReducer`, no persistence | unchanged — do **not** add Drizzle tables for this |
| Auth | none | dashboard's custom cookie session already gates everything |

Both repos are **Next.js 16 + React 19 + Tailwind v4**, so this is a straight file copy plus
wiring. There are no framework-version conflicts to resolve.

---

## 1. Files to copy verbatim

Copy these with their paths preserved (the `@/*` alias points at the repo root in this repo; the
dashboard repo uses the same root-level alias, so imports resolve unchanged):

```
lib/affiliate-finder/types.ts
lib/affiliate-finder/conversationState.ts
lib/affiliate-finder/mockData.ts
lib/affiliate-finder/format.ts
lib/affiliate-finder/discoveryClient.ts     # server-only
lib/affiliate-finder/apifyClient.ts         # server-only
lib/affiliate-finder/claudeClient.ts        # server-only
lib/rateLimit.ts

components/affiliate-finder/AffiliateFinderShell.tsx
components/affiliate-finder/ChatThread.tsx
components/affiliate-finder/MessageBubble.tsx
components/affiliate-finder/Composer.tsx
components/affiliate-finder/DiscoveryResultCard.tsx
components/affiliate-finder/EnrichmentSummaryCard.tsx

components/shared/card.tsx
components/shared/button.tsx
components/shared/checkbox.tsx
components/shared/data-table.tsx

app/api/discover/route.ts
app/api/enrich/route.ts
```

**Do NOT copy:**

- `app/affiliate-finder/page.tsx` — replaced by the dashboard's AI Chat page (§3).
- `app/page.tsx` — this repo's root is just a `redirect()` to the chat. The dashboard has its own
  root. (Note: the dashboard's `CLAUDE.md` flags an existing duplicate-route problem between
  `app/page.tsx` and `app/(home)/page.tsx` — that is a pre-existing issue, unrelated to this port,
  but `next build` will fail until it's resolved, so fix it before trying to verify this work.)
- `app/layout.tsx` — the dashboard's own root layout wins.
- `components/affiliate-finder/ThemeToggle.tsx` — the dashboard owns theming; a second,
  local-state toggle that flips `document.documentElement.classList` would fight it.
- `app/globals.css` — do **not** overwrite the dashboard's. See §4 for the specific tokens to
  verify instead.
- `lib/utils.ts` — this repo's `cn()` is a hand-rolled `filter(Boolean).join(" ")`. The dashboard
  already has a `cn()` at `lib/utils.ts` (clsx + tailwind-merge). Keep the dashboard's; the call
  signature is compatible, so no component edits are needed.

### `components/shared/*` name collision

The dashboard is configured for shadcn (`components.json`, style `base-vega`, baseColor `neutral`)
but has **no `components/ui/*` scaffolded yet**. Copy `components/shared/*` as-is into
`components/shared/` — do not try to rewrite these four against shadcn primitives as part of this
port. `data-table.tsx` in particular is the single shared table recipe the discovery and summary
cards both depend on; hand-rolling a raw `<table>` in its place will break the layout. Migrating
these to shadcn later is a separate task.

---

## 2. Dependencies and env

**Add to the dashboard's `package.json`:**

- `@anthropic-ai/sdk` (`^0.116.0` here) — required by `discoveryClient.ts` and `claudeClient.ts`.
- `lucide-react` — the dashboard already lists lucide as its shadcn `iconLibrary`; verify it is
  actually installed, and install it if not. Icons used: `ArrowUp`, plus whatever
  `DiscoveryResultCard` / `EnrichmentSummaryCard` / `checkbox.tsx` import.

`apifyClient.ts` calls Apify over plain `fetch` — no Apify SDK dependency.

**Env vars to add** (the dashboard reads `.env.local` for app runtime and `.env` for `db:*`; put
these where the rest of the app's runtime secrets live):

```
ANTHROPIC_API_KEY=
APIFY_TOKEN=
```

Both are optional in the sense that every code path has a fallback and the app runs without them —
`scopeRequest` degrades to keyword matching, discovery degrades to `mockData.ts`. `APIFY_TOKEN` is
the more impactful of the two, since Apify is the actual discovery engine.

---

## 3. Mounting the chat in the dashboard shell

### 3a. Strip the standalone page chrome

`AffiliateFinderShell.tsx` currently renders its own full-screen frame:

```tsx
<div className="flex h-dvh flex-col bg-background">
  <header className="flex items-center justify-between border-b border-border px-6 py-3">
    …Affiliate Finder / TikTok creator discovery · Philippines…
    <ThemeToggle />
  </header>
  …
</div>
```

Inside the dashboard that duplicates the sidebar header and double-scrolls. Make exactly these
changes and nothing else:

1. Delete the `<header>` block and the `ThemeToggle` import.
2. Change the outer wrapper from `h-dvh` to `h-full` (`flex h-full flex-col bg-background`) so it
   fills the dashboard's content area rather than the viewport.
3. Ensure the dashboard's AI Chat content area is itself a full-height flex container, otherwise
   `h-full` collapses and the composer floats mid-page.

Everything below the header — the scroll region, `max-w-6xl` thread, the `state.stage === "intake"`
composer footer — stays exactly as written.

### 3b. The page

Create the AI Chat page as a server component that renders the client shell, mirroring
`app/affiliate-finder/page.tsx`:

```tsx
import { AffiliateFinderShell } from "@/components/affiliate-finder/AffiliateFinderShell";

export default function AiChatPage() {
  return <AffiliateFinderShell />;
}
```

Put it at whatever route the existing **AI Chat** sidebar item already points to, inside the
dashboard's route group so the sidebar layout wraps it. If that route currently renders a
placeholder composer ("How can I help you today?"), that placeholder is replaced entirely — the
Affiliate Finder composer (`Composer.tsx`, 500-char cap, Enter-to-send) is the only discovery entry
point and must not be swapped for the dashboard's own input.

---

## 4. Design tokens — verify, don't overwrite

The components are styled directly against OKLCH CSS variables. Before assuming a visual bug,
confirm the dashboard's `app/globals.css` defines **all** of these, in both `:root` and `.dark`:

`--background --foreground --card --card-foreground --popover --popover-foreground --primary
--primary-foreground --secondary --secondary-foreground --muted --muted-foreground --accent
--accent-foreground --destructive --border --input --ring --radius`

Tailwind v4 also needs the `@theme inline` block mapping each token to a `--color-*` name
(`--color-card: var(--card)` etc.) plus the `--radius-sm/md/lg/xl/2xl` scale, or utility classes
like `bg-card` and `rounded-xl` silently produce nothing. Both repos already use the class-based
`.dark` variant (`@custom-variant dark (&:is(.dark *))`), so dark mode carries over.

Palette differences are expected and fine — the dashboard's green/neutral brand tokens will simply
re-skin the chat. Only *missing* tokens are a problem. `--destructive` matters specifically: the
"Not found — needs manual outreach" contact state renders as `text-destructive` and must stay
visibly distinct.

Fonts: this repo maps `--font-sans` to Geist. No chat component references a font variable
directly, so the dashboard's font stack applies automatically.

---

## 5. Auth and the API routes — the one real gotcha

The dashboard's `lib/middleware.ts` (`updateSession`, re-exported as `proxy` from root `proxy.ts`)
**redirects every request whose path doesn't start with `/login` or `/auth` and has no valid
session.** That gate applies to `/api/discover` and `/api/enrich` too.

- **Logged-in users are fine.** The client `fetch()` calls are same-origin, so the session cookie
  rides along and the requests pass the gate.
- **Check the proxy matcher.** If it excludes `/api`, nothing to do. If it doesn't, verify a
  session-less call to `/api/discover` gets a redirect rather than a JSON response — an unhandled
  HTML redirect body would make `res.json()` throw inside `AffiliateFinderShell`. The shell's
  `catch` blocks already fall back gracefully, so this is a correctness detail, not a crash, but
  confirm the behaviour is the one you want.

**Optional improvement (not required):** `lib/rateLimit.ts` is a 5-req/min fixed window keyed by
client IP, in-memory. Now that every caller is authenticated, keying it by session user id instead
is more accurate behind a proxy. Keep it in-memory either way — persisting it would violate the
no-database constraint for this feature.

---

## 6. Constraints that must survive the move

These are load-bearing. Do not "clean them up" during the port.

- **No persistence of any kind** for the chat — no localStorage, no cookies, no Drizzle tables, no
  Supabase rows. All state is the one `useReducer` in `AffiliateFinderShell.tsx`. A reload resets
  to the start.
- **Discovery is hard-capped at 10 results**, enforced inside `apifyClient.ts`
  (`MAX_RESULTS_PER_CATEGORY`), not just in the UI.
- **Contact fields are never fabricated.** A missing email/viber/mobile renders as an explicit
  "Not found — needs manual outreach" in `text-destructive`, never a blank cell.
- **Enrichment only ever runs against user-selected creators**, never the full top-10 batch. This
  is deliberate cost control for both Apify and the Anthropic API.
- **Fallback-on-failure is load-bearing.** `scopeRequest`, `discoverTopCreators`, and
  `enrichCreators` each catch every failure mode (missing key, timeout, bad response, refusal) and
  fall back to the next link in the chain, always returning the same shape as the live path. Never
  let a fallback throw; never let a network failure surface as a broken UI state.
- **Free-text chat is the only entry point.** There is no category-pill UI. `scopeRequest` returns
  both category and keywords in one tool-less Anthropic call — do not reintroduce a separate
  classifier or a web_search-based discovery path.
- **Philippines-only scope** on every Apify actor call (`region`/`proxyCountryCode: "PH"`, PH
  hashtags in the fallback tier, plus a post-fetch `isPhilippineScoped()` filter).

Other built-in limits to leave alone: message truncation at 500 chars (`Composer.tsx`
`MAX_MESSAGE_LENGTH` and `discoveryClient.ts` `MAX_MESSAGE_CHARS` must stay in sync),
`MAX_KEYWORDS = 3`, `MAX_PRODUCTS_FOR_CREATOR_LOOKUP = 5`, `APIFY_TIMEOUT_MS = 20_000`, bios
truncated to 400 chars in `claudeClient.ts`.

---

## 7. Anthropic structured-output pitfalls (carried over)

`output_config.format.schema` is stricter than plain JSON Schema. Two traps already hit in this
codebase — both are **400s on every call**, not intermittent:

- `maxItems` on an `array`-type schema is rejected. Cap array length in code with `.slice(...)`
  after parsing, never in the schema.
- A field typed `["string", "null"]` with an `enum` listing the strings plus `null` is rejected.
  Express it as `anyOf: [{type: "string", enum: [...]}, {type: "null"}]` — see `SCOPE_SCHEMA` in
  `discoveryClient.ts` for the working pattern.

Both fail **loudly in the server console** (`[discoveryClient] … failed:`) and **silently in the
UI** — a rejected request just makes the function return `null` and fall back, which reads as
"discovery isn't finding anything." Always check the `next dev` terminal before diagnosing a
discovery-quality issue.

---

## 8. Verification

**Do not run the dev server and hit `/api/discover` or `/api/enrich` to "verify" a change.** Both
routes call the Anthropic API, and `/api/discover` also calls Apify — every hit burns real tokens
and credits. The user tests the live path manually.

Verification for an agent means:

```bash
npm run build
```

```bash
npm run lint
```

```bash
npx tsc --noEmit
```

(The dashboard repo has no dedicated typecheck script and no test runner; `npm run build` runs the
TypeScript check.)

---

## 9. Post-port checklist

- [ ] All files in §1 copied; excluded files in §1 **not** copied.
- [ ] `@anthropic-ai/sdk` and `lucide-react` installed.
- [ ] `ANTHROPIC_API_KEY` and `APIFY_TOKEN` present in the dashboard's runtime env.
- [ ] `AffiliateFinderShell` header + `ThemeToggle` removed; `h-dvh` → `h-full`.
- [ ] AI Chat route renders the shell; its layout gives the content area full height.
- [ ] Every token in §4 present in `:root`, `.dark`, and the `@theme inline` block.
- [ ] Pre-existing `app/page.tsx` vs `app/(home)/page.tsx` duplicate route resolved so
      `next build` can succeed.
- [ ] Session-gated `/api/discover` behaviour confirmed against the proxy matcher.
- [ ] `npm run build`, `npm run lint`, `npx tsc --noEmit` all clean.
- [ ] Manual smoke test by the user: type a request → 10 creators → select a few → enrich →
      CSV export.
