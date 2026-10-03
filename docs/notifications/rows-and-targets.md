# Notification rows and targets

This page covers where a notification row sends you, how a plugin raises one, the order a click
navigates in, how a row picks its glyph, and what archiving a task removes. It's part of
[notifications](../notifications.md).

## What a row points at

A target is `{ kind, resourceId, subresourceId? }`. The handler table in
`packages/client-core/src/features/notifications/notifications.ts` resolves it. The kind decides who
answers, and each owner registers its own handler:

- The terminal plugin opens a drawer on a tab.
- The agents plugin opens a session in the Agent pane.
- The workflows plugin opens the run pane at a node of the run.
- The memory plugin opens the Memory page on the proposal. Its proposal-gate notice is about however
  many proposals are waiting, so that one targets the page through core's `source` kind instead.

The workflows kind is `workflow-run`. `resourceId` is the run and `subresourceId` is the node, and
the handler opens the task's Workflows pane there ([workflows](../workflows.md) § The run pane).
Every notice a run raises carries this target. A gate is also an attention row, with `warn`
severity so it stays until somebody answers it, the same target, and the ID `workflow:gate:<stepId>`.
A run that ends `failed` or `safety-rail` raises a `run-failed` notice, and a run that ends well
raises `run-done`.

An agent's permission question inside a run stays the agents plugin's row and opens the Agent pane.
The question belongs to the session, and the run pane's header has a chip for a reader who wants the
run instead.

Two kinds belong to core, because what they open belongs to no plugin:

| Kind | `resourceId` | Who answers |
| --- | --- | --- |
| `settings` | A settings page ID | The shell, which owns the modal (`apps/desktop/src/client/activate.ts`) |
| `source` | A rail source ID | `packages/client-core/src/host/chrome/chromeRegister.ts`, so both hosts answer |

A loaded plugin's rows carry display strings only. An attention descriptor names no target, and the
Node drops a notice's target. Naming a target means naming another plugin's handler and any resource
ID, which is the impersonation `events.send` refuses. So the host supplies the target for that tier:
the plugin's own rail source or, for a plugin with none, the Settings page that lists it.
`packages/client-core/src/host/plugins/rowTargets.ts` computes it for both readers, because they
arrive at different times. The attention source asks during the registration pass, and a notice
arrives off the socket with only a plugin ID.

## Raising one from a plugin

On the Node, call `ctx.events.notice({ taskId?, title, detail?, kind?, target? })`. It belongs to
core, so it works whether or not any other plugin is enabled. A target is core's own shape, shared
with the attention inbox, so nothing on the shared context knows what a workflow run is.

A compiled plugin writes the whole row, names its own target kind, and registers the handler for it
with `registerNoticeTargetHandler` from `@acorn/plugin-api/client`. A loaded plugin writes the
title, the detail, and the task, and the host fills in the rest.

`kind` names a registered notice kind. An unregistered kind resolves to `plugin`, so the bell never
draws an unlabeled warning mark on a row that might be good news.

## Getting there before the target runs

A click on a row moves in this order:

1. **The Node**, when the row belongs to another one. Every path resolves against the active Node,
   so navigating first would look up an ID that isn't there, or find a different thing with the
   same name.
2. **The task**, from `taskId`, or **the project**, from `projectId`. A row carries one or the other.
   A task route carries no project, so the task wins as the more specific of the two.
3. **The target**, last. A target that selects a `projectScoped` rail source draws whatever project
   is routed. Arriving on the wrong project would open the page with the row's own subject filtered
   out. The memory rows need this step.

Routing to a project in another workspace changes the active workspace. The per-workspace view
memory in `apps/desktop/src/client/App.tsx` then restores that workspace's last view over the source
the target selected. Only a task jump can opt out, through the `keep-task` transition in
`packages/client-core/src/features/workspaces/workspaceViewTransition.ts`. So a cross-workspace row
lands in the right workspace on the wrong view. The row is still in the bell, and a second click
works. The fix is a `keep-source` transition in that module.

## What a row is drawn with

`glyph` is a Lucide name a source can put on its own rows. Without one, the inbox draws `info` or
`triangle-alert`, chosen by `severity`.

The tone follows the severity either way. What a row is and how urgent it is are two questions. A
memory proposal is a nudge whether or not it carries the memory mark, and a source that could soften
its own warning with a friendly glyph would make the section unreadable.

## Archiving a task takes its notices with it

A notice points at a task. After the task is archived, the row would still count toward the pill
and a click would go nowhere. So the ring listens for `runtime:task-archived` and drops that task's
rows. `deliver.ts` wires it beside the eviction on a Node switch, because both answer one question:
what does this client forget when the thing it was about goes away?

It drops active-Node rows only. The event carries no Node ID, and two Nodes can hold the same task
ID, which is the same filter `markTaskRead` keeps.

This covers what the client watched happen. A task archived from another device stays in the ring
after the next boot, because notices load from a preference blob that nothing checks again. That row
is stale, not wrong. Checking it would mean asking the Node about 50 task IDs before the bell can
draw.

Attention items need none of this. The client fetches them per Node, so a row whose state has gone
stops coming back.
