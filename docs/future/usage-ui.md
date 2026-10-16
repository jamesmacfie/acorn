# Plan usage with one row per account

Date: October 16, 2026. Status: proposed. Implementation not started. Starting point: `cbab9e505`.

Use this plan to change the plan usage popover in the Agent pane, so that a harness with several
accounts shows one row per account instead of a row of tabs. Each row carries a health dot and small
bars for the session and the week, so you can compare accounts without switching. Open a row to see
that account's full numbers. The change is all client side, in `plugins/agents/src/client/usage/`.

## Problem

The panel is one two-column list across every harness. The harness name and its refresh button sit
in the left column. When a harness has extra accounts, a `Tabs` control sits in the right column,
above the account line. Two things go wrong:

- The tabs float in the value column with empty space to their left, so they read as a separate
  panel stuck onto the list.
- The tabs show one account's numbers at a time. You have two accounts so you can start work on the
  one with room left, and the tabs hide exactly that comparison. You have to click through each tab
  and remember the figures.

The list is also long. A Claude Code account adds up to nine rows of daily cost and token figures
under its three quota bars, so the second harness falls below the fold of a 460-pixel popover.

## Goal

Each harness becomes its own block:

1. A header row with the harness name and its refresh button, across the full width.
2. For a harness with one reading, that reading's numbers sit directly under the header, as they do
   today.
3. For a harness with several readings, each account gets one closed row: a health dot, the account
   name, and two small bars with percentages. Opening the row shows the account line, any error,
   and the full quota rows with their pace marks.
4. The daily figures fold into one summary line, such as "Today ≈$178 · 1.8M tokens · 9 sessions".
   Opening it shows the full list.

The account that new sessions start on, or the selected session's account, starts open. The others
start closed.

The mockup for this design is option C in `/private/tmp/plan-usage-mockup/index.html`. It's a
scratch file, so it might be gone. The mockup draws Codex as a closed row too. This plan keeps a
single-reading harness open with no row, because a row labelled "Usual sign-in" tells you nothing.

## Starting point

Recheck these against the checkout before you start.

| Piece | Where |
| --- | --- |
| The panel: one `DescriptionList`, the per-harness tab choice, and the `Tabs` control | `plugins/agents/src/client/usage/AgentUsageSection.tsx:30`, `:45`, and `:72` |
| The popover, its 460-pixel width, and the `defaultAccounts` it passes down | `plugins/agents/src/client/usage/AgentUsageIndicator.tsx:34` and `:82` |
| Which account each harness shows: the selected session's account, or the new-session default | `usageAccounts` in `plugins/agents/src/client/sessions/AgentPane.tsx:68` |
| Grouping readings by harness, and the tab id and label helpers | `usageGroups`, `usageTabId`, and `usageTabLabel` in `plugins/agents/src/client/usage/usageModel.ts:111-117` |
| The detail rows: quotas with meters, then cost, then daily figures | `providerUsageRows` in `plugins/agents/src/client/usage/usageModel.ts:174`, daily part from `:205` |
| The account line: plan, email, organization, freshness | `providerMetaLine` in `plugins/agents/src/client/usage/usageModel.ts:93` |
| The window a one-line summary reads, session then weekly | `summaryQuota` in `plugins/agents/src/shared/usage.ts:144` |
| Dot and bar colours by health | `usageTone` and `usageMeterTone` in `plugins/agents/src/client/sessions/stateTone.ts:50` and `:61` |
| The reading type, one per harness and account | `AgentProviderUsage` in `plugins/agents/src/shared/usage.ts` |
| The disclosure row, with `leading`, `meta`, and controlled `open` | `Fold` in `packages/client-core/src/kit/components/layout/Fold.tsx:29` |
| A meter in a fold's `meta` slot gets a fixed width | `.ui-fold-meta .ui-meter` in `packages/client-core/src/infra/styles/primitives.css:2125` |
| Tests to change | `plugins/agents/src/client/usage/AgentUsageSection.test.tsx:66` and `usageModel.test.ts` |

## No Node or wire change

The snapshot already holds every account's reading. The usage service asks a collector registered
with `accounts: true` once per account and returns each as its own `AgentProviderUsage` row with
`accountName` set (`docs/managed-agents/accounts.md` § Plan usage). The tabs only choose which of
those rows to draw. So this plan touches no collector, route, or type in `shared/usage.ts`, and the
five-minute poll and per-harness refresh keep working unchanged.

## Design

### The panel

Replace the single `DescriptionList` with a `Stack` of harness blocks. Each block has:

- A header `Inline`: the harness name in `Text`, then the refresh `IconButton` the panel already
  draws, with the same label, spin, and disabled rules.
- A single-reading harness: the body described in [The account body](#the-account-body), with no
  fold around it.
- A multi-reading harness: one `Fold` per reading, in snapshot order.

Giving up the one shared list means the value column no longer lines up across harnesses. That was
the reason the list was shared. Inside a block, each account body keeps its own two-column
`DescriptionList`, so quota rows still line up within an account. That trade is worth it: the
harness blocks are visually separate, and the old alignment is what pushed the tabs into the value
column.

### The account row

Each reading in a multi-reading harness is a `Fold` with:

- `leading`: a `StatusDot` with `usageTone(reading.health)`, labelled with the health.
- `label`: `usageTabLabel(reading)`. Rename it `usageAccountLabel`, because nothing is a tab any more.
- `meta`: up to two compact readings. Each one is an `Inline` holding a muted short label, a
  `Meter` with `usageMeterTone(quota.health)`, and the percentage left. Draw no pace mark. The bar
  is too short to read one.
- `level="sub"`, so it reads as part of the harness block.
- Controlled `open` and `onOpenChange`, described in [Which rows start open](#which-rows-start-open).

The compact readings come from a new model function, `compactQuotas(reading)`. It returns the quota
with id `session` and the quota with id `weekly`, when present. A harness with neither, such as a
contributed one, gets its first two quotas. The short label is "5h" for `session`, "week" for
`weekly`, and `quota.label` for anything else. A reading with no quotas, such as one with an error,
shows no bars. Its dot and its body's `Alert` say why.

The mockup puts column headings above the bars. A `Fold` summary has no slot for that, and a
heading row drawn outside the folds would drift out of line with them. The short label inside each
cell avoids both problems.

### The account body

The body is what a tab showed, in this order:

1. The account line: `StatusDot` and `providerMetaLine(reading)`. Inside a fold, drop the dot,
   because the row above already carries it.
2. The error `Alert`, when the reading has one.
3. A `DescriptionList` of the quota rows and the cost rows, drawn as today, with a `Meter` and pace
   mark under each quota sentence.
4. The daily figures, in a nested `Fold` labelled with the summary line.

Split `providerUsageRows` so the body can place the daily rows separately:

- `providerUsageRows(reading)` keeps the quota and cost rows.
- `dailyUsageRows(reading)` returns the daily rows, built by the code at `usageModel.ts:205`.
- `dailySummary(reading)` returns the fold label: the estimate, the non-cache token total, and the
  session count, joined with " · ". It returns `null` when `reading.daily` is null, and the body
  draws no fold.

Give the daily fold `persistKey="agent-usage-daily"`, so it stays the way you last left it. One key
for every account is enough. Nobody wants the figures open for one account and closed for another.

### Which rows start open

Replace the `picked` signal at `AgentUsageSection.tsx:30` with a record of open states keyed by
`${provider}:${usageTabId(reading)}`. A row with no stored state is open when its account is the one
`defaultAccounts[provider]` names, or the first reading when that names nothing. When you open or
close a row, store your choice.

When `defaultAccounts` changes, because you selected a session on another account, the new account
starts open. Rows you toggled keep your choice. Rows you never touched follow the default. Today's
rule, which drops your tab pick when the default changes, has no equivalent here, because more than
one row can be open at once. Keep the record in the component, not in `localStorage`. The popover
starts fresh each time it mounts, as it does today.

### The terminal client

The terminal kit exports `Fold`, `Meter`, `StatusDot`, and `Popover` (`apps/tui/src/kit/ui.ts`). If
the terminal client draws the Agent pane's usage button, check the panel there too. Closed rows are
shorter than the tab layout, so the change should help a 24-row terminal, not hurt it.

## Steps

1. In `usageModel.ts`, add `compactQuotas`, `dailyUsageRows`, and `dailySummary`. Take the daily
   rows out of `providerUsageRows`. Rename `usageTabLabel` to `usageAccountLabel`. Keep
   `usageTabId`, or rename it `usageAccountKey`. Either way, update its callers.
2. In `usageModel.test.ts`, cover `compactQuotas` for a Claude reading, a Codex plan with only a
   weekly quota, a contributed harness with other ids, and a reading with no quotas. Cover
   `dailySummary` with and without daily data. Update the `providerUsageRows` label list test at
   `usageModel.test.ts:173`, which expects the daily labels in that list.
3. In `AgentUsageSection.tsx`, build the harness blocks, the account folds, and the account body as
   described above. Drop the `Tabs` import. Update the comment at the top of the file, which
   describes the tab layout.
4. In `AgentUsageSection.test.tsx`, replace the tab test at `:66`. Check that the default account's
   row is open and shows its email, that the other row is closed and shows its bars and percentages,
   and that clicking the closed row's summary shows its email. Fold bodies render on first open, so
   a closed row's email isn't in the DOM until then. Add a case where `defaultAccounts` names the
   second account. Keep the refresh test as it is.
5. Run `pnpm test:focus @acorn/plugin-agents usage`, then the agents plugin's type check and lint.
6. Look at the popover in a real window with two Claude Code accounts signed in, one of them low on
   its session. Check that the bars line up across rows, that the long account line doesn't widen
   the popover, and that the daily fold remembers its state after you close and reopen the popover.
   If you can't sign in a second account, the
   `screenshot-a-plugin-tree-without-the-app` memory describes how to draw the tree with fixture
   data and the real host CSS.

## Docs to update

- `docs/managed-agents/accounts.md` § Plan usage: replace "draws a tab per account, so the numbers
  below are one account's at a time" with the row-per-account layout. Replace "opens the panel on
  that account's tab" with "opens the panel with that account's row open".
- `docs/managed-agents/providers.md` § Plan usage: add that the daily figures sit in a fold under
  each account's quotas.
- `docs/future/README.md`: remove this plan's row once it ships, and add it to the table of
  completed plans with the two reference pages above as owners.

## Risks and open questions

- **Fold summary text style.** A `Fold` summary uses the shared `.section-header` class. At
  `level="sub"` that might draw the account name in a heading style that looks heavier than the
  mockup. If it does, raise it as a kit question. Don't add plugin CSS.
- **Bar alignment.** The `meta` slot doesn't grow, so the bars sit at the right edge of each row and
  line up only if the cells are the same width. "100%" is wider than "25%". If the drift shows,
  ask whether the kit should give `ui-fold-meta` text tabular figures, rather than padding the
  strings.
- **Many accounts.** Each closed row is one line, so five accounts cost five lines. Nobody has asked
  for more than two. Don't add scrolling or a cap until someone does.
- **Losing cross-harness alignment.** The quota sentences of Claude Code and Codex no longer share a
  value column. The mockup shows that this reads fine, because each harness has its own header.

## Acceptance

- A harness with two accounts shows two rows. Each row shows a dot, the account name, and session
  and week bars with percentages, without opening anything.
- The selected session's account starts open. With no session selected, the new-session default
  starts open.
- Opening a row shows the account line, any error, the quota rows with pace marks, the cost rows,
  and the daily summary fold.
- A harness with one reading looks as it does today, minus the daily rows, which sit in the fold.
- The refresh button beside each harness refreshes that harness only.
- The usage button in the pane header is unchanged.
