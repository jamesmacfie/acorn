# Client surfaces

This page covers the client side of managed agents: how reads and drafts belong to a Node and session,
the Agent pane and Agent Center, and when a session leaves the live list. The client code is in
`plugins/agents/src/client/`.

## Client surfaces

These pages cover the rest of the client:

- [The transcript](./transcript.md) covers the timeline window, tool cards, request cards, and
  subagent views.
- [The composer](./composer.md) covers the message field, mentions, and composer slots.
- [The transcript store](./transcript-store.md) covers how the client holds and reads a session's
  events.
- [Transcript search](./transcript-search.md) covers the full-text index.

## Reads and drafts

A session read captures its Node and the store generation before it dispatches, and continuation pages
use that Node. A switch, clear, or deletion rejects a departed read before it publishes rows, indexes
events, or starts another page. Holds and cleanup belong to their generation, so an outgoing surface
can't release an incoming one's hold. Agent Center and session launches use the same check.

Unsent text, attachment IDs, and context belong to a Node and session. Both composers share hydration
and send guards. A successful send clears text only if its edit revision matches, and removes the
exact attachment and context objects it sent. Switching Nodes keeps unsent work in memory and in local
storage. Deleting a session removes its draft. Empty drafts release their memory when their last
surface leaves, and dirty drafts aren't evicted. A storage failure keeps the draft in memory.

The local record key is `acorn.agent-payload.` and the JSON pair of Node ID and session ID, with
`.text`, `.attachmentIds`, and `.contexts` suffixes, so a keystroke writes only the text.

Attachment and artifact cards share a cache entry keyed by Node, media kind, and ID: metadata, bytes,
and one data URL. Downloads reuse the held bytes. Idle entries keep at most 16 MiB, and entries on
screen can exceed that. The raster allowlist and the 8 MiB inline preview limit
(`MAX_INLINE_IMAGE_BYTES`) apply.

The client claims the `agent` WebSocket channel when its first frame subscriber attaches and releases
it when the last leaves. Plugin activation holds one subscription for attention. A lazy surface, such
as an inline diff card, doesn't register a channel.

## The Agent pane

The Agent pane is a `list-detail` layout ([layouts](../panes/layout.md)). The list column is the task's
roster of managed sessions, delegated children, and provider-native subagents, with a header region so
the count stays put. The detail column is the open session: a header, the transcript, and the
composer. Every surface is a tree of kit nodes with no stylesheet, so the same source draws in the
shell and through the remote root ([the closed kit](../ui-design/closed-kit.md)).

The header waits only for the module and the session list. The harness list is the shared
`['agents', 'providers']` query, so a second task reads it from memory. Until it answers, the **New**
menu and empty state say they're checking which agents this Node can run.

The conversation is keyed by session ID. A different ID disposes the previous transcript, snapshot
subscription, and view controls. Drafts and reading places live in session-keyed stores. Navigating to
an editable session focuses its message field without scrolling. Streamed events don't move focus.

After the title, the header hosts the `agents:session-header` remote `stack` point. Its props are a
projection: task and session IDs, provider ID, per-turn usage and prices, and token and cost
accounting modes. The bundled `agent-cost` plugin prices and formats those. Disabling it removes the
badge. The pane sends a new payload only when usage changed, because every payload crosses to the
plugin's worker ([remote trees](../plugins/remote-points.md#remote-points)).

The pane shows the transcript, composer, queue, context, requests, artifacts, and roster. The first
three are one component, `AgentConversation`, addressed by session ID. The Workflows run pane draws the
same one through the `agents.conversation` client capability, so a session can be on screen twice.
What two composers must agree on lives in a map keyed by Node and session
(`plugins/agents/src/client/composer/composerState.ts`).

Roster rows show the live model and reasoning effort from `configOptions`. A subagent inherits that
summary unless the provider named another model. Starting an interactive session selects the durable
row at once and shows **Connecting…** above an editable composer. **Send** waits until the handshake,
metadata, and saved defaults settle. Workflow creation returns when ready.

Managed sessions, workflow runs, and inline chats each have an order button: running first, name,
newest first (the default), or latest activity. The choice is saved per task and group in the
`agents.session-order` state slice (`sessionOrder.ts`). Latest activity reads `lastEventAt`, which the
Node leaves out of the row-change check, so the order re-sorts when a turn starts or ends.

The task sidebar keeps a **Needs you** list. Picking a row opens that session and brings its request
card into view.

## Agent Center

Agent Center gathers sessions, search, provider health, attention, transcript import, and launch. Its
header shows the active, attention, and session counts. Provider health shows compact cards with a
name and status dot. Its archived filter offers **Restore** for a session archived on its own.

A provider draws as its own mark wherever it's named: onboarding cards, the **New** picker, Settings,
and Agent Center. The mark comes from the descriptor's `glyph`. The built-ins are `brand:agents/claude`
and `brand:agents/codex`, drawn by `ProviderGlyph.tsx` with the color mixed toward the theme's
foreground, because a brand color is authored against white.

## Retired and archived sessions

A session lives as long as its task. Sessions under a task that's archived, cancelled, or deleted with
its project are retired. They leave every live list, including Agent Center, the Fleet stat, the
attention inbox, and the `sessions` dashboard source, and show in the archived list. Retirement is
worked out when the list is read, because deleting a project removes its tasks and no cascade would
reach those rows. A read that names a task ID is exempt. On an archived task, the Agent pane is
read-only ([restoring a task](../workspaces-and-tasks/archive.md#restoring-a-task)).

Archiving is the only way the UI retires a session. The pane header's menu and each row's menu offer
rename, archive, and stop while running. Archive asks first. The delete route exists for callers that
mean it.

Terminal handoff gives a raw provider TUI an exclusive input lease, so a managed session and a
terminal can't write the same provider session at once. Notifications and the attention inbox show
requests that need you.
