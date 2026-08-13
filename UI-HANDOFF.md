# UI-HANDOFF.md — bring `/ui-ux` + `design.md` into a new session

Paste this whole file (or just link it) at the start of a session when you need Claude
to build/edit UI in this repo without re-deriving the conventions from scratch. It's a
pointer + cheat-sheet, not a replacement — the two source docs remain canonical and may
have moved on since this was written.

## What to load, and in what order

1. **`.claude/skills/ui-ux/SKILL.md`** — invoke via `/ui-ux` or `Skill({skill: "ui-ux"})`
   before touching any component, page, Tailwind class, color, chart, card, table,
   filter, or layout. This is the engineering-convention doc: stack facts (Tailwind v4
   CSS-first, Base UI not Radix, Next 16 ahead-of-training-data), token rules, available
   `src/components/ui/*` primitives, server/client split.
2. **`design.md`** (repo root) — the visual spec: exact class recipes for page headers,
   filter bars, KPI cards, chart cards, tables, tabs, badges, plus a live **§7 Known
   deviations** fix-list and an **§8 New-page checklist**.
3. **Canonical reference file**: [src/app/(app)/sales/sales-analytics/_components/index.tsx](src/app/(app)/sales/sales-analytics/_components/index.tsx).
   When the skill and design.md disagree, or something isn't covered, copy this file.

Rule of thumb: skill = *how the stack is wired*, design.md = *what it should look like*.
Read both before writing/editing UI; read neither if the task is pure backend
(service/repository/API route) with no rendering involved.

## One-line trigger to reuse this pattern in a new session

> "Read the `ui-ux` skill and `design.md`, then [task]." — or just invoke `/ui-ux` first,
> then reference `design.md` §-sections by number when asking for a specific recipe
> (e.g. "build this per design.md §4 Table recipe").

## Condensed cheat-sheet (fallback if you can't load the full docs)

- **Tokens only, no hex/gray-*.** `bg-background`, `bg-card`, `text-foreground`,
  `text-muted-foreground`, `border-border`, `bg-primary/15 text-primary`, status trio
  `emerald-500` / `yellow-500` / `text-destructive`. Charts: `var(--chart-1..5)` only.
- **Page wrapper**: `<div className="flex flex-col gap-6 p-6">` — always, on top of the
  shell's own `p-4 lg:p-6`. Don't strip it as "double padding."
- **Typography**: one h1 style (`text-xl font-semibold tracking-tight`), one subtitle
  style (`text-sm text-muted-foreground`), KPI value `text-3xl font-semibold
  tracking-tight`, micro-labels `text-xs font-medium uppercase tracking-widest
  text-muted-foreground`. Numbers get `tabular-nums`; money as `₱X.XM`/`₱XK`.
- **Filters**: only `src/components/filters/` components — `MultiSelectFilter`,
  `SingleSelectFilter`, `DateRangeFilter`, `YearPillSelect`, `ClearFiltersButton`. Never
  hand-roll a year `<select>` or Clear-all button.
- **Tables**: Card shell, no header fill, `px-3 py-2` cells, `border-border/40` rows,
  `hover:bg-muted/40`, sort ↕/↑/↓, `PAGE = 25` pager. No shared `<DataTable>` component
  exists yet — hand-rolled per design.md §4/§7 until one is extracted.
- **Loading state**: blur (`blur-sm`) + `absolute inset-0 bg-background/30 animate-pulse`
  overlay. Never spinners/skeletons.
- **Components**: shadcn "base-nova" on **Base UI**, not Radix. Only 13 primitives exist
  in `src/components/ui/` — no `table`, `tabs`, `select`, `badge`, `dropdown-menu`,
  `checkbox`, or `skeleton` primitives; those are hand-rolled per-file, copied from
  sales-analytics.
- **Server/client split**: thin `async` server `page.tsx` → `*.service.ts` → `"use
  client"` dashboard component in a colocated `_components/` folder. Client re-fetches
  `/api/*` on filter/year change.
- **New-page checklist** (design.md §8): wrapper padding, header recipe, server→service→
  client split, tokens-only + dark-mode check, KPI/ChartCard/table/tab/filter recipes
  reused (no new one-offs), chart consts (`GRID_PROPS`/`AXIS_PROPS`/`MARGIN`),
  `tabular-nums`/₱/lucide icons, blur-loading + standard empty states.

## Known-deviations list (design.md §7) — check before assuming a file is "correct as-is"

Some existing pages/components are flagged as off-spec and slated for opportunistic
fixes (placeholder `text-lg`/`text-5xl` headers, hardcoded hex in `app-sidebar.tsx`,
non-standard table chrome in `users-table.tsx`/`roles-table.tsx`, threshold colors at
`-400` instead of `-500`, duplicated `KpiCard`/`ChartCard`/tab-strip implementations, no
shared `DataTable` component yet, a dead nav route). Don't copy these files as the
pattern — see design.md §7 for the current list and intended fix.
