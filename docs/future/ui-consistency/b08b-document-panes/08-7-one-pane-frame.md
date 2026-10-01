# 08-7. The document panes do not share one frame

**Status:** not started. Batch B08b. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

Measured side by side, the task's document panes build their headers five ways. Context has no chrome
bar: a 31-pixel strip with "context" in lower case at level 3. Findings has no detail header, so its
title floats while the list header beside it is a 48 bar. The Notes title field is a palette input,
41 high with its own underline 4 pixels above the bar's divider, so the header has two lines.
Switching panes in one task changes the header's height, fill, and left edge.

## Where to see it

**Review changed files**: open Context, Findings, and Notes in turn, and compare their headers with
Changes and the agent pane.

## Already done

- K2's P9 makes a `Toolbar` inside the `header-body-footer` header the bar, with one divider.
- K2's P10 put the first `DocumentTabs` label on 14.
- K2's 08-6 made the Findings split reach both pane edges.
- K4a's 08-3 made **Open agent run** draw its label.

## The fix

- `plugins/context/src/client/ContextPane.tsx:23-34`: the header becomes a `Toolbar` with
  `Heading level={2}` "Context", the summary as a muted count, and **Refresh** at the end.
  `ContextHeader`'s message `Alert` (`:31`) sits under the bar.
- `plugins/findings/src/tree/FindingsPane.tsx:100-113`: the detail header is a `Toolbar` with
  `Heading level={2}`, the badges, `ToolbarSpacer`, and **Open agent run** at sm.
- `FindingsPane.tsx:240-253`: the list header is `SectionHeader` "Findings" with the segmented control
  in `actions`.
- K2 noted the detail's "OBSERVATION" heading is a group label at 28 from the column edge. A `sub`
  heading or `Heading level={3}` puts it on 14.
- `packages/client-core/src/infra/styles/primitives.css` (around `:822-829`), for the Notes title
  (`plugins/notes/src/client/NotesPane.tsx:146-155`):
  `.ui-toolbar .ui-input[data-kind='bare'] { padding: 0; border-bottom: 0; min-height: var(--control-h-sm); font-size: var(--fs-lg); font-weight: var(--heading-weight); background: transparent }`.
- The Notes and Changes list headers follow the house list header (label and count, B02's 02-9 shape).

## Copy

Findings pane rows that no other finding owns, and the Context and Notes header rows.

| Where | Current text | Decision | New text |
| --- | --- | --- | --- |
| `ContextPane.tsx:28` | context | Rewrite | Context, as `Heading level={2}` in a bar |
| `ContextPane.tsx:29` | {n} sections · {n} items | Keep | |
| `NotesPane.tsx:22` | {workspace name} (header label) | Rewrite | Notes |
| `FindingsPane.tsx:241` | Findings (strong text) | Keep | As a `SectionHeader` label. |
| `FindingsPane.tsx:249` | Active / All | Keep | |
| `FindingsPane.tsx:264-265` | Memory suggestion / Review suggestion, {n} source(s) | Rewrite | Memory suggestion / Review suggestion, "From {n} findings" |
| `FindingsPane.tsx:273-276` | No active findings / Withdrawn observations remain available under All. | Rewrite | No active findings / Withdrawn ones are under All. |
| `FindingsPane.tsx:273-276` | No findings yet / Task observations appear here when an agent or producer records them. | Rewrite | No findings yet / Agents record findings here as they work. |
| `FindingsPane.tsx:150-151` | Formatting repaired / This older record was captured from streamed text. Acorn compacted the broken line fragments for readability; open the source run for the original transcript. | Rewrite, keep one short line | Title "Formatting repaired". Inline: "acorn tidied broken lines in this older record. Open the agent run to see the original." `Alert` has no `help`, so the plan keeps it inline. |
| `FindingsPane.tsx:183` | Withdrawn observation / No reason supplied | Rewrite | Withdrawn / No reason given |
| `FindingsPane.tsx:301` | Could not load findings | Rewrite | Couldn't load findings |
| `FindingsPane.tsx:304-305` | Select a finding / Choose an observation to read its detail and provenance. | Rewrite | Select a finding / Its details and where it came from show here. |
| `FindingsPane.tsx:293` | Load older findings | Keep | |

## What earlier batches give you

- **A `Toolbar` in the hbf header** (K2's P9). It keeps its inline pad, because the toolbar's
  pull-out margin takes it back.

## Risk and checks

- Before you start, check Docker's task pane, the other `header-body-footer` pane. Its chip strip is
  not a toolbar and stays as it is.
- The bare-input rule reaches any bare input in a toolbar. Grep for `kind="bare"` and check each.
- Findings is a loaded plugin. Rebuild its bundle.
- Screens: Context, Findings (list and detail), and Notes, beside Changes.
- Tests: `plugins/context`, `plugins/findings`, `plugins/notes`, and client-core.
