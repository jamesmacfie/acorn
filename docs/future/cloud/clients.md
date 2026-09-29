# What changes in desktop and TUI

Status: proposed, 2026-09-29. Desktop and TUI are where people do cloud work. Both share
`@acorn/client-core` and `@acorn/custody`, so most changes land once and both clients inherit them.
This file lists every client change, in the order the phases need them.

## Principles

- **No cloud, no change.** A client with no cloud plugin installed, or not signed in, looks and
  behaves exactly as it does today. The Fleet source still appears only once more than one Node is
  paired.
- **One project, one task.** A cloud task appears in its project's task list, not as a separate
  fleet workspace for each worker. See [refused](./refused.md#no-node-switch-for-each-cloud-task).
- **Node-scoped caches stay Node-scoped.** Each hosted Node, including each worker, gets its own
  query cache keyed by its Node ID, like any paired Node.
- **Server state decides.** Which Node answers a task's live calls comes from the team Node's attempt
  record, never from client guesswork.

## Signing in

The cloud plugin adds a **Cloud** page in Settings. Signed out, it shows **Sign in**. Signing in
runs the device flow on the local Node ([identity](./identity.md#how-each-client-signs-in)). The
desktop opens the browser with the code filled in. The TUI prints the URL and code. Signed in, the
page shows the account, the teams, and **Sign out**, which deletes the connection on the local Node
and forgets every grant.

## Adopting the team Node

The cloud plugin is a Node provider. Its `list` returns the team Nodes the account can reach, with
each Node's vouched fingerprint and relay route. The host adopts a team Node through the existing
provided-Node path in Settings → Nodes, and refuses a fingerprint mismatch.

What changes in custody:

- **A second credential kind.** A fleet record for a hosted Node holds no device token. It holds a
  pointer to the provider that issues its grants. Before each connection, and a minute before
  expiry, custody asks the provider for a fresh grant and relay ticket. Custody changes live in
  `packages/custody/src` beside `packages/custody/src/custody/deviceTokenStore.ts`.
- **The relay socket factory.** See [relay](./relay.md#what-changes-in-the-client).
- **A new connection reason.** A signed-out account or an expired membership shows as `offline`
  with a reason, not a new state. The broker's state vocabulary does not grow.

## Publishing a project

The project menu gains **Publish to team**. The dialog names the team, the members who can read it,
and the region. After publishing, the project shows a small team marker, and its task list unions
local and cloud tasks. See [projects and tasks](./projects-and-tasks.md#shared-projects).

## Creating a cloud task

The new-task flow gains a location choice when the project is shared: **Local** or **Cloud**, with the
project's default preselected. Choosing **Cloud** shows, before anything is spent:

1. The input: a Git revision, or a snapshot preview listing tracked changes and untracked files to
   pick, with total size.
2. The plugin lock for this attempt, with any blocked plugin and its reason.
3. Missing cloud connections or settings, each with a link for an admin to fix.
4. The spend estimate, the team's remaining budget, and the idle rule. From phase 10.

**Run in cloud** then reserves and provisions. The task appears in the rail at once, in
`reserved`, and moves through its states.

## Adopting a worker

This is the largest client change, and the first spike in [phase 5](./phases/05-cloud-task.md).

A task's panes call their Node through the active Node's API client. A cloud task's live data is on
a worker, which is not the active Node and not a fleet workspace. So the client needs:

- **A hidden fleet member per live attempt.** When the team Node reports an attempt as
  `setting-up` or later, custody adopts the worker with its vouched fingerprint and relay route,
  flagged as a worker of a logical task. It never appears in the Fleet view or the Node switcher. It
  is forgotten when the attempt ends.
- **Task-scoped routing.** Each pane gets its API client from the task, not from the active Node. For
  a local task, that is the task's own Node, as today. For a live cloud task, it is the worker. For
  an archived one, core and agent reads go to the team Node, and plugin panes show
  **Restore detail**.
- **Plugin availability per Node.** A worker's plugin roster decides which panes are available for
  its task. The client's per-Node plugin reconciliation already handles a roster per Node, and the
  per-hash trust decision carries over.

An alternative is to route a worker's traffic through the team Node, so the client only ever talks
to one Node. It keeps the client simple but puts every terminal stream through the team Node. That
trade-off is an open question in phase 5.

## Watching a cloud task

The task header shows location, attempt state, region, and, from phase 10, spend so far. Setup
shows its steps: checkout, dependency install, plugin start. A failed attempt shows its reason and
**Recover**. An agent waiting for an answer shows that the worker is still running and still
billing.

Notifications use the existing notice path. A cloud agent that needs input rings the bell on every
client signed in to the team, filtered by role: viewers do not get approval prompts.

## Offline and partial states

| Situation | What the client shows |
| --- | --- |
| Team Node reachable, worker unreachable | Live panes offline with their last cached data. Transcript from the team Node's copy. |
| Team Node unreachable | Cloud tasks show their last cached state. No new cloud tasks. Local work unaffected. |
| Relay down | Every hosted Node offline with a relay reason. Local work unaffected. |
| Signed out | Hosted Nodes offline with a sign-in reason and a **Sign in** action. |
| Role changed to viewer | Mutating actions disappear on the next refetch, and the Node refuses them regardless. |

Mutations never queue, as today. A failed mutation keeps the person's text as a draft.

## TUI parity

The TUI supports every flow above except the browser handoff, which it replaces with a printed URL
and code. Snapshot file picking needs a keyboard-driven list. The TUI's PTY test driver should gain a
`tui-cloud` fixture with a fake team Node, so the navigation flow can cover cloud tasks.

## Testing the desktop and TUI changes

Use the real Tauri window through `pnpm dev:agent` and the UI driver for desktop, and the isolated
PTY driver for the TUI, as [local development](../../local-development.md) describes. A local
`docker compose` stack with the account service, relay, and a local provisioner lets both drivers
run cloud flows without a real provider.

## Verify before building

Check how panes get their API client today in `packages/client-core`, and how much of that assumes
the active Node. Check how the plugin distribution snapshot handles a Node that appears and
disappears every few minutes.
