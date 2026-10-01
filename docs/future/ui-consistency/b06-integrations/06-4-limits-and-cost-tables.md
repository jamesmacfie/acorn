# 06-4. Limits and cost: the price tables leave the page

**Status:** not started. Batch B06. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

Each model's name and id are two spans with nothing between them, so a row reads
"Claude Fable 5claude-fable-5". That run-on name makes the Claude model column about 415 wide, so the
table is 892 wide in a 720 column. **Cache read** and **Reset** scroll out of sight, and macOS hides
the scrollbar. The Codex table on the same page is 731 wide and clips **Reset**. **Reset** and
**Remove** are bare buttons, 12 high, and a disabled **Reset** shows on every untouched row. The one
column people come here to edit, the cache price, is the one they cannot see.

## Where to see it

Settings › Limits and cost (agents plugin). Scroll to **Claude prices** and **Codex prices**.

## Already done

- K1b's 05-1 scoped the column-heading look to `th[scope='col']`. The row label now reads as text in
  `--text`, not grey capitals. The name and id still run together.

## The fix

All in `plugins/agents/src/client/settings/AgentPricingSettings.tsx`:

- Around `:191-194`: put the name and the id in a `Stack gap="none"`. The name goes first, then the id
  as muted mono `Text`. The model column drops to about 190, and the table fits 720
  (190 + 4 × 106 + 53 = 667).
- Around `:216-230, 295-307, 349`: **Reset** and **Remove** become `Button variant="ghost" size="xs"`.
  **Reset** shows only on a row that differs from its default, like `SettingRow`'s own **Reset**.
- Around `:175`: say the pricing sentence once, as `help` on each **{Provider} prices** section.

## Copy

From `AgentConcurrencySettings.tsx` and `AgentPricingSettings.tsx`.

| Where | Current text | Decision | New text |
| --- | --- | --- | --- |
| `AgentConcurrencySettings.tsx:54` | How many agent turns this Node runs at once. A session always runs one turn at a time, so these ceilings only decide how many sessions can be working together. Turns over a ceiling wait in the queue and start as soon as there is room. | Move to `help` on **Turns at once**, rewrite | How many agents can work at the same time on this node. Extra work waits in line and starts when there's room. |
| `AgentConcurrencySettings.tsx:58` | Counted against one agent CLI across every task and workspace, so a single provider account never runs more turns than this. | Rewrite, keep inline | For each agent CLI, such as Claude Code, across all tasks. |
| `AgentConcurrencySettings.tsx:77` | Counted across all providers in one workspace, so one workspace cannot take the machine. | Rewrite, keep inline | For each workspace, across all agent CLIs. |
| `AgentPricingSettings.tsx:151` | Unpriced models / Models seen in recent Claude usage that have no price. Add one to give it an exact price under Claude prices. | Rewrite, keep inline | Claude models you used recently that have no price. Add a price so acorn can estimate their cost. |
| `AgentPricingSettings.tsx:175` | Estimated USD API prices per million tokens. They change Acorn's estimates only. They do not change what a provider bills or how a subscription applies usage. | Move to `help` on each **{Provider} prices**, rewrite | acorn uses these for cost estimates, in US dollars per million tokens. They don't change what you're billed. |
| `AgentPricingSettings.tsx:239-240` | Exact model ids / For a model that is not in the built-in list. An exact entry takes priority over a built-in price. | Rewrite | Label **Other models**. Inline: "For a model that isn't listed above. Its price overrides a built-in one." |
| `AgentPricingSettings.tsx:248` | No exact model prices. | Rewrite | No other models. |
| `AgentPricingSettings.tsx:228, 305, 349` | Reset / Remove | Keep | As ghost xs. **Reset** only on a changed row. |

## What earlier batches give you

- **`help` on `SettingsSection`** (K3). See [the help-mark rule](../house-patterns.md#the-help-mark).
- **`Text` at 12px for every emphasis** (K1b's P7), so muted mono sits at the working size.

## Risk and checks

- Before you start, confirm the table still renders the name and id as two spans.
- Measure both tables at the default window size. Both must fit 720 with every column visible.
- Screens: Limits and cost, top and bottom.
- Tests: `plugins/agents`.
