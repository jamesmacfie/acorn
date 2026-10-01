# 11-17. The usage popover and the session cost badge

**Status:** not started. Batch B11. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

In the agent usage popover, each provider is its own `Facts` list, sized separately, so Claude's values
start 40 pixels right of Codex's and the meters do not line up. "Est. cache savings ≈$1918.12" has no
thousands separator and shows cents an estimate cannot back. Codex's plan reads "Prolite", the provider's
id with a capital. The session cost badge is an interactive `Chip` used as a readout, with its
explanation in a native `title`, and it shows four decimals under a dollar.

## Where to see it

The agent pane header's usage button ("Claude Code 82% · Codex 69%"). The cost badge is read from code.

## Already done

- K4a's 03-17 gave the popover a "Plan usage" group header, so its section header is consistent with the
  other popovers.

## The fix

- `plugins/agents/src/client/usage/AgentUsageSection.tsx:57-80`: one `Facts` across both providers.
- `plugins/agents/src/client/usage/usageModel.ts:19-20`: `Intl.NumberFormat` for estimates only, with no
  cents. `formatUsd` also formats real spend, so do not change it for everything.
- `usageModel.ts:67`: known plan ids to names, with a sentence-case fallback for unknown ones.
- `plugins/agent-cost/src/tree/SessionCostBadge.tsx:13-19`: a `Badge` with `tip` in place of the `Chip`.
- `plugins/agent-cost/src/tree/sessionCostLabel.ts:1-6`: two decimals, and "<$0.01" below a cent.

## Copy

| Where | Current text | Decision | New text |
| --- | --- | --- | --- |
| `usageModel.ts:67` | Prolite (the plan id, capitalised) | Rewrite | Known ids: "Pro Lite", "Team", "Max". Unknown ids fall back to today's sentence-case string, so "Claude Max" still shows (the plan's overrule). |
| `usageModel.ts:137` | pricing unavailable | Rewrite | No price for this model |
| `usageModel.ts:150` | Est. cache savings | Rewrite | Saved by caching (estimate) |
| `AgentUsageSection.tsx:32` | Reading local provider usage… | Rewrite | Reading usage… |
| `SessionCostBadge.tsx:14` | Estimated API-equivalent session cost from reported tokens and configured model prices. Provider billing may differ. | Rewrite, as a tip | Estimated from the tokens used and the prices in Limits and cost. Your bill may differ. |
| `SessionCostBadge.tsx:15` | Session cost reported by the provider. | Keep | As a tip. |

## What earlier batches give you

- **`Badge tip`** (K3's P14). A tipped badge is a tab stop with `role="note"`.

## Risk and checks

- Before you start, list every caller of `formatUsd`, so the estimate change does not reach real spend.
- The pace mark under each meter still has no legend; the area file suggested a tip on the meter
  ("The mark shows where steady use would be by now"). Add it if it is a one-line change.
- Screens: the usage popover.
- Tests: `plugins/agents`, `plugins/agent-cost`. Rebuild the agent-cost bundle.
