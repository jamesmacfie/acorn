# 08-8. Context: four left edges, checkboxes far from their labels, and meters that change size

**Status:** not started. Batch B08b. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

In the Context pane, text starts at four insets: header 14, fold label 35, item marker 23, item text
38. Each section's include box is the fold's action, pushed about 1,270 pixels away from its label,
with only an `ariaLabel`. Each meter is as wide as the size text beside it, so two budgets draw two bar
lengths that mean nothing. The footer holds md buttons in a 48 bar. Item rows use a text "▸" and show
the kind twice ("scratch Review checklist (scratch)"). The pane that decides what the agent reads makes
its most important control the hardest to connect to its section.

## Where to see it

**Review changed files** › **Context** pane.

## Already done

- K1a added `Fold leading`, a slot for a control before the fold's label.

## The fix

- Shared CSS:
  `.layout-hbf-body > .ui-stack > .ui-fold > .ui-fold-summary { margin-inline: calc(-1 * var(--pane-pad)); padding-inline: var(--pane-pad) }`.
- `plugins/context/src/client/ContextPane.tsx:118-122`: the include box goes in the fold's `leading`
  slot, before the label.
- `.ui-fold-meta .ui-meter { width: calc(var(--space-11) * 2) }`.
- `ContextPane.tsx:163-195`: footer buttons at sm.
- `ContextPane.tsx:51-161`: item rows use `TreeRow` instead of the text "▸", with the kind once as a
  `Badge`.

Putting **Add memory** in the section's actions needs the cross-plugin `context:section` slot contract
to change, and is deferred (see [deferred.md](../deferred.md)).

## Copy

| Where | Current text | Decision | New text |
| --- | --- | --- | --- |
| `ContextPane.tsx:19, 21` | 🤖 / seed, ◆ task / ws / 🌐 | Rewrite | The Notes helper's words ([08-12](./08-12-notes.md)). |
| `ContextPane.tsx:79-80` | {kind} {label} | Rewrite | {label}, with the kind once as a `Badge`. |
| `ContextPane.tsx:119` | Include {section} (aria only) | Rewrite, add a tip | "Include in the agent's context". The plan's overrule uses one phrase for the include box here and in Notes. |
| `ContextPane.tsx:167` | preview | Rewrite | What the agent gets |
| `contextModel.ts:31` | agent session | Rewrite | Choose a session |
| `ContextPane.tsx:174` | No running agent session. | Rewrite | No agent is running for this task. |
| `contextModel.ts:35-38` | not synced / synced · {ago} / stale · {n} changes | Rewrite | Not sent yet / Sent {ago} / {n} changes since you sent it |
| `ContextPane.tsx:189` | Sync context | Rewrite | Send context |
| `contextModel.ts:104` | No running agent session. | Rewrite | No agent is running for this task. |
| `paneContribution.ts:12` | What an assembled send includes | Keep 02's rewrite | What the agent gets when you send |

The plan's overrules: rows 709 and 712 use "No agent is running for this task."; rows 710 and 711 say
"send" throughout. `ContextPane.tsx:126`'s "⚠" is [08-24](./08-24-smaller-defects.md) item d.
`:155` ("Assembling…") is done by [08-15](../b08a-changes-and-diff/08-15-changes-states.md).

## What earlier batches give you

- **`Fold leading`** (K1a's P2). The slot sits inside the `<summary>`, after the disclosure mark and
  before the label, click-isolated from the toggle the way `actions` is. Pressing the box checks it
  and leaves the fold closed. The terminal draws it between the mark and the label: `▸ [x] picked`.

## Risk and checks

- Before you start, confirm `ContextPane` still renders its sections as `Fold`s in a `Stack`.
- The shared rule reaches any fold directly inside an hbf body's stack. Check Docker's task pane.
- Never add a memory through the app. The memory plugin writes the real `~/.acorn/memory`. Open the
  memory form and stop.
- Screens: Context with three sections.
- Tests: `plugins/context`, `plugins/memory`, client-core.
