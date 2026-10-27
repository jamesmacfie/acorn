# Rank palette commands by use

Date: October 28, 2026. Status: proposed. Implementation not started.

The command palette ranks every command the same way for everyone. A command you run ten times a
day sits wherever its author put it. This plan teaches the palette which commands you use. It ranks
them higher when a query matches them equally well, and it lists a few of them first when you open
the palette with nothing typed.

[The palette session](../command-palette-and-shortcuts/palette.md) and
[palette commands](../command-palette-and-shortcuts/commands.md) own the palette's behavior. Both
pages win if this plan disagrees with them, and the session page changes when this lands.

## Starting point

Checked against main at `db4fa6f7c`.

- `buildCommandGraph` in `packages/client-core/src/host/registries/commands/graph.ts` ranks a typed
  query. `ranked` sorts by `fuzzyScore`, then by the author's `order`.
- `fuzzyScore` (`packages/client-core/src/kit/lib/controls/fuzzy.ts`) adds 1 to 3 points for each
  matched character. Two commands that match a short query often score the same, so the author's
  order decides most ties.
- With nothing typed, `rootRows` in `sessionRows.ts` shows the top-level commands in author order.
  `groupRows` does the same inside a group.
- Every command row runs through the `executeCommand` the session passes to `rootRows` and
  `groupRows` (`sessionStore.ts`). Entering a group, search, input, or setting command goes through
  `activateRow`. Nothing records either.
- The desktop and the terminal client share one session (`createCommandSession`), so a change there
  reaches both palettes.
- The workspace switcher (`⌘L`) already lists workspaces most recent first, from
  `workspaceHistorySlice` in `packages/client-core/src/infra/persistence/stateSlices.ts`. That slice
  is the pattern to copy for storage.

## What other palettes do

These are the designs this plan borrows from, and what each one gets right.

- **VS Code** remembers the last 50 commands you ran. With nothing typed it lists them first under
  "recently used". With a query, the recent matches still come first. It doesn't use a formula.
- **Sublime Text and Alfred** remember which result you picked for which query. Type "ss", pick
  **Set Syntax**, and "ss" means **Set Syntax** from then on. This does the most for short
  abbreviations.
- **Firefox's address bar** introduced _frecency_, a score that mixes how often and how recently.
  It weights each of the last 10 visits by age: 100 points within 4 days, down to 10 points after
  90 days.
- **z and zoxide**, the shell directory jumpers, multiply a visit count by a recency factor, and
  shrink every score once the total grows past a cap, so old habits fade.
- **Slack's quick switcher and Raycast** also rank by frecency.

The lesson across all of them: use counts only as a nudge, let old use fade, and keep a good text
match above a frequent poor one.

## The design

### Count palette picks

Record a use when a person picks a command row in the palette and it runs, or when they enter a
search, input, or setting command. Entering a group doesn't count, because a group only opens a
submenu. A pick counts even if the command then fails, which keeps the recording at one place.

Commands run by keyboard shortcut or from a menu don't count. A person who has a shortcut for a
command doesn't need the palette to find it. Search results, such as tasks, workspaces, and
database rows, don't count either. Their ids can carry names that shouldn't sit in storage, and
`⌘L` already orders workspaces by visit.

### Keep one decaying score per command

For each command id, store a score and the time of its last use. On a use, update it:

```text
score = score × 2^(-(now - lastUsed) / halfLife) + 1
lastUsed = now
```

To compare commands, decay each stored score to the current time with the same factor. The
half-life is 7 days. A command used daily stays near the top, and one you stopped using a month ago
falls to a sixteenth of its weight.

This does what Firefox's age brackets do with one number and one timestamp per command, and no
table to tune.

Keep at most 200 entries. On each write, drop entries whose decayed score is below 0.05, then drop
the lowest until 200 remain. Unknown ids, such as a removed plugin's commands, stay inert and age
out on their own.

### Store it on the device

Add a persisted state slice beside `workspaceHistorySlice`, with `scope: 'app'`, and add its key to
`DEVICE_KEYS` in `devicePrefs.ts`. Usage is a habit of one person on one machine, like
`PrefKeys.keybindings`, so it stays on the device rather than going to the Node. The terminal
client gets the same storage through its `localStorage` shim
(`apps/tui/src/plugins/devicePreferenceStorage.ts`). The slice needs about 16 KB at 200 entries.

The slice stores command ids and numbers only.

### Break ties with use

In `rootRows` and `groupRows`, sort the hits from `graph.ranked` by fuzzy score, then by decayed
use. `Array.prototype.sort` is stable, so remaining ties keep the author's order that `ranked`
already applied. `graph.ts` doesn't change, so anything else that searches the graph keeps author
order.

A better text match always wins. Use only decides between matches of equal score. Blending use
into the score itself is a later choice, made only if tie-breaking turns out too weak in daily use.

### Show recent commands with nothing typed

At the root with an empty query, list up to five commands with the highest decayed use above the
top-level commands. Each row shows its breadcrumb, as a search hit does, and a **recent** badge.
The row id is `recent:<commandId>`, so a recent command that is also a top-level command doesn't
put two rows with one id in the list.

Only list a command whose graph node is discoverable in the session's context. A task command
doesn't appear in a palette opened over no task.

Groups opened with nothing typed keep author order. The rows inside a group are short lists that
people learn by position.

### Read usage once per opening

Read the usage snapshot when the session opens, and rank from that snapshot until it closes. A
command whose outcome keeps the palette open must not move the rows under the cursor.

## Out of scope

- Remembering which command was picked for which query, as Sublime Text and Alfred do. It's the
  natural next step if abbreviations still feel slow, and it needs its own pruning rules.
- Ranking search results, setting options, or the workspace switcher by use.
- Syncing usage between devices.
- Sending usage to telemetry.

## Open questions

- Should Settings have a way to clear recent commands, or turn the recent rows off? A shared screen
  shows them. The plan leaves both out until someone asks.
- Is five recent rows right for the terminal client's 24-row screen? Check it with the terminal's
  palette open over its smallest layout.

## Acceptance

Unit tests, beside the existing ones in `sessionStore.test.tsx` and a new test for the score:

- The score decays to half after one half-life, and two uses a half-life apart sum to 1.5.
- Pruning keeps 200 entries and drops scores under 0.05.
- Two commands with equal fuzzy scores swap order when the second has more use. A command with a
  higher fuzzy score stays above a more used one.
- The empty root lists recent rows first, leaves out commands the context hides, and keeps distinct
  row ids.
- Entering a group records nothing. Running a command and entering a search command each record one
  use.
- A command whose outcome keeps the palette open doesn't reorder the rows.

Live checks, in `pnpm dev:agent` and in the terminal client:

1. Run a command from the palette three times, reopen the palette, and see it in the recent rows.
2. Type a query that matches it and a rarely used command equally, and see the used one first.
3. Restart the client and see the recent rows survive.

When it lands, describe the ranking in [the palette session](../command-palette-and-shortcuts/palette.md),
then remove this plan and list it under
[completed plans removed](./README.md#completed-plans-removed).
