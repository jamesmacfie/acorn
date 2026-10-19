# Phase 6: let plugins mark an agent session

Date: October 19, 2026. Status: proposed. Needs nothing.

## Goal

The agents plugin declares `agents:session`, an annotation point keyed by session. A plugin answers
with marks for the sessions on screen, and agents draws them on Agent Center rows, on the task's
session list, and in the Agent pane's header. A mark can carry a short Markdown detail, so "Struggling"
can list its reasons where the person looks for them.

## Starting point

- `core:task` is the model ([task annotations](../../plugins/rows-and-annotations.md#task-annotations)).
  It's declared in `packages/protocol/src/chrome/extensionPoints.ts` and listed in
  `packages/protocol/src/chrome/publicExtensionPoints.ts`, and
  `packages/client-core/src/host/annotations/taskAnnotations.ts` registers it, batches one request per
  contributor for the visible keys, and turns marks into rail markers.
- A point that sets `acceptsDetail` keeps a mark's Markdown `detail`, up to 16 KiB, and the owner draws
  it through `richTooltipDom`, which sanitizes it and credits the plugin. `editor:line` is the one
  point that sets it.
- Agent Center's rows are drawn in `plugins/agents/src/client/center/AgentCenter.tsx`, and a task's
  session list in `plugins/agents/src/client/sessions/AgentTaskSidebar.tsx`.
- Agents already owns compiled and loaded points, such as `agents:tool-card`, declared in the same two
  protocol files, and the agents client checks its declarations in
  `plugins/agents/src/client/extensionPoints.test.ts`.

## The design

### The point

```ts
{ id: 'agents:session', kind: 'annotation', key: ['session'], max: 2, acceptedMarks: 256, acceptsDetail: true }
```

The key is the session id alone. A session id is unique on its Node, and a plugin that needs the task
can find it from its own reads. Two marks per session is the drawing limit, because a row has room for
two before its title truncates. Marks past two stay in the row's accessible description and its
tooltip legend, as `core:task` keeps its fifth.

The trust prompt reads "Mark agent sessions in Agent Center and the Agent pane", from the host's table.

### Where agents draws it

- **Agent Center rows.** After the session's title and before its time: a severity dot and the mark's
  text, cut at the row's width. Focus or hover on the mark opens its detail.
- **The task's session list.** A severity dot only, because the list is narrow. Its text and detail
  are in the row's tooltip and accessible description.
- **The Agent pane header.** Beside the session title, the dot and the text, with the detail on focus.

Each surface asks for the session ids it draws, through the shared `requestAnnotations`. Agent Center
asks for one page of rows at a time, so a long list costs one request per contributor per page.

The terminal draws the dot and the text after the session row's title in Agent Center and the session
list. It shows no detail, and [what a plugin loses in the
terminal](../../tui/plugin-losses.md#what-a-plugin-loses-here) gains a row saying so.

### Refreshing

A contributor tells the host its marks changed the way any annotation contributor does: through its
own descriptor invalidation or its live channel ([freshness](../../plugins/freshness.md)). The analytics
plugin invalidates when [phase 2](./02-turn-facts.md)'s `turn-facts` event names a session it has
marked or would mark.

## Steps

1. Declare the point and its key constant in `packages/protocol/src/chrome/extensionPoints.ts`, and
   list it in `packages/protocol/src/chrome/publicExtensionPoints.ts`.
2. Register it in the agents client, beside its other points, and add it to the extension point test.
3. Draw marks on the three surfaces, on desktop and terminal.
4. Add the point to [places to fill](../../contribution-kinds.md#places-to-fill) and to
   [rows and annotations](../../plugins/rows-and-annotations.md).

## Acceptance

- A test contributor marks one session. Agent Center, the session list, and the pane header show it,
  and the detail opens on focus with the plugin's credit.
- A mark with a `javascript:` link in its detail draws the text without the link.
- **Settings > Advanced > Extension points** lists `agents:session` with the contributor.
- With no contributor, the three surfaces draw exactly as before.
