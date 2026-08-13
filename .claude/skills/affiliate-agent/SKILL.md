---
name: affiliate-agent
description: Scope and guardrails for the TikTok Affiliate Finder's Claude API usage (creator discovery, category classification, contact enrichment). Use when touching lib/affiliate-finder/discoveryClient.ts, apifyClient.ts, claudeClient.ts, mockData.ts, app/api/discover/route.ts, app/api/enrich/route.ts, or anything that calls the Anthropic API in this repo.
---

# Affiliate Agent

Narrow scope for the three server-only modules that call external APIs on behalf of the
`/affiliate-finder` feature. Read this before adding, removing, or changing any Anthropic or Apify
call in this repo — the point of this skill is to keep those calls small, cheap, and inside the
existing fallback chain rather than growing into a general-purpose agent.

## The three calls this app is allowed to make, and only these

| Module | Calls | Model | Purpose |
|---|---|---|---|
| `lib/affiliate-finder/discoveryClient.ts` | `discoverWithClaude` | `claude-sonnet-5` + `web_search_20260209` (max_uses: 6) | Find ≤10 real PH TikTok creators for a category |
| `lib/affiliate-finder/discoveryClient.ts` | `classifyCategory` | `claude-sonnet-5`, no tools | Resolve free-text chat into `beauty \| skincare \| sunscreen \| null` |
| `lib/affiliate-finder/claudeClient.ts` | `enrichCreators` | `claude-sonnet-5`, forced tool call | Extract email/viber/mobile from bios of **selected** creators only |

Everything else about the app (chat UI, reducer/state machine, CSV export, table rendering) is
plain code with no model call. **Don't introduce a fourth call site** — e.g. don't add a Claude
call for chat copy, message rephrasing, or UI text unless the user explicitly asks for it; the
existing three are deliberately the full surface.

## Non-negotiable constraints on every call site

- **Never throws.** Every exported function in these three modules catches its own failures
  (missing `ANTHROPIC_API_KEY`, network error, `stop_reason: "refusal"`, empty/malformed result)
  and returns `null` (discovery/classification) or falls back to a regex/mock path (enrichment) —
  never lets an exception escape to the route handler. Preserve this on every edit.
- **Fallback chain order is fixed:** discovery is Claude → Apify → mock; enrichment is Claude →
  regex. Don't reorder these or add a new tier without updating `CLAUDE.md`.
- **Hard caps stay hard caps:** `MAX_RESULTS_PER_CATEGORY = 10` (discovery, enforced independently
  in both `discoveryClient.ts` and `apifyClient.ts`), `max_uses: 6` on the web_search tool,
  `MAX_CREATORS_PER_CALL = 10` and bios truncated to 400 chars (enrichment), messages truncated to
  500 chars before classification. Raising any of these requires the user's explicit sign-off —
  they exist for cost control on metered APIs, not as arbitrary defaults.
- **Enrichment only ever runs on user-selected creators**, never the full discovery batch — this
  is the main cost control on the enrichment call and must not be relaxed to "enrich all 10."
- **PH-only scope is a prompt constraint, not just a filter.** `discoverWithClaude`'s prompt must
  keep instructing the model to confirm a Philippines connection and skip anything it can't
  confirm — don't drop this even when broadening categories or rewording the prompt.
- **Structured output, not free text.** Discovery and classification use `output_config.format`
  (JSON schema) so the route never has to parse prose; enrichment uses a forced tool call for the
  same reason. Keep new prompts on this pattern rather than parsing `response.content[0].text`.
- **No fabricated contact data, ever.** `enrichCreators` and its regex fallback must only report a
  value that is literally present in the bio text — this is a product requirement (see
  `CLAUDE.md`'s "Contact fields... never fabricated" constraint), not just a prompt nicety.

## Verification — do not spend live tokens to check your own work

`npm run build` (typecheck) and `npm run lint` are the full verification loop available to Claude
Code here. **Do not run `npm run dev` and exercise `/api/discover` or `/api/enrich` yourself** —
both hit the live Anthropic API (and `/api/discover` can also hit Apify), and every call costs
real money regardless of whether the change was correct. The user tests manually. If you need to
confirm request/response shapes, read the Anthropic SDK types or `shared/` skill docs — don't
probe the live API.

## Where the full picture lives

This skill is deliberately narrow — it's the guardrail, not the architecture doc. For the complete
state machine, component tree, and rationale behind the fallback design, read `CLAUDE.md` at the
repo root before making structural changes (e.g. changing the fallback order, adding a fourth
external call, or changing what `/api/discover` accepts).
