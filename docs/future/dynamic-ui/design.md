# Agent-built apps: the design

Status: proposed, 2026-10-01. This is the target model. The phase files order the work,
[research.md](./research.md) holds the evidence, and [refused.md](./refused.md) records the alternatives.

## The idea

An agent in a task builds a small UI for that task while the owner watches: a triage board over the
linked issues, a checklist for a migration, a chart of error counts, a form that fills in a request.
It shows up inline in the conversation. The owner asks for a change in the next message and gets a new
version. If it proves useful, it opens as a pane in the task. If it proves useful beyond the task, the
owner promotes it to the project, where anyone working on the project can open it from the left rail.
If it grows into a product, it exports as an ordinary plugin.

Lemma does a version of this with raw HTML in iframes. Acorn can do it better, because it already has
the hard part: a remote component tree tier where plugin code runs in a sandboxed worker and draws the
host's own components ([descriptors, trees, rectangles](../../plugins/ui-tiers.md)).
An agent-built app drawn that way gets the shell's keyboard handling, focus, accessibility, and style
pack for free, and it draws in the terminal client too.

## Terms

| Term | Meaning |
| --- | --- |
| _App_ | A UI an agent builds: a small plugin package with one client tree and no node half. |
| _Card_ | An app drawn inline in an agent transcript. |
| _Task app_ | An app that belongs to one task. It is archived and restored with the task. |
| _Project app_ | An app published to a project. It outlives any task. |
| _Draft_ | A task app that edits a project app. Publishing a draft replaces the project app's current version. |
| _Revision_ | One validated version of an app's files. Revisions are numbered and immutable. |
| _Head_ | The revision an app runs. |
| _App profile_ | The narrow set of things an app may do, enforced by the host. See [what an app can reach](#what-an-app-can-reach). |
| _App trust_ | A per-device, per-Node decision that lets apps built on that Node run without a prompt per revision. |

"App" is the product word. When it could be confused with the desktop app, say "agent-built app".

## One identity from the start

An app is a plugin package from the moment it is created, not a new kind of object that becomes a
plugin later. Its folder holds a manifest and one client file, the shape the scaffold already produces
with no build step ([start from the scaffold](../../plugin-authoring/start-from-the-scaffold.md)).

This decision is what makes the rest cheap. A task app, a project app, and an exported plugin are the
same files with different ownership and lifecycle. Promotion changes an owner field. Export copies the
package out of the app namespace. Nothing is converted. Lemma reached the same conclusion from the
other side: its code comment calls a conversation widget and an app "the same primitive", which is
why its promotion route takes the source unchanged.

On disk, under the Node's data root:

```text
apps/
  <appId>/
    app.json                  owner, name, description, head, draft link, source session
    revisions/<n>/
      acorn-plugin.json       the manifest, restricted to the app profile
      client.js               the tree
      note.txt                the agent's one-line summary of what changed
    state.json                the app's own saved state, see "App state"
```

The host installs the head revision through the local-folder install path that dev mode already uses
([the dev loop](../../plugins/dev-loop.md#the-dev-loop)), under a reserved plugin ID prefix so apps
never collide with real plugins and never appear in **Settings > Plugins > Installed**. They appear on
the Apps page instead.

## Where apps show up

| Placement | Where | When |
| --- | --- | --- |
| Card | Inline in the agent transcript, as the tool card for `app_show` | Every time an agent shows a revision |
| Task pane | One **Apps** button in the task's right rail, with a list of the task's apps and the selected app beside it | The task has at least one app |
| Project pane | One **Apps** source in the left rail, listing the routed project's apps, each opening a project-scoped pane | The workspace has at least one project app |

Each placement renders the same tree. The host passes the placement as a prop, so an app can draw a
compact version in a card and a full version in a pane.

The task pane follows the workflows pane: one button, gated so a task that never built an app does not
get it ([panes](../../panes.md)). One button per task, not one per app, because the right rail is a
fixed list of what a task always has.

The left rail gets one **Apps** source, not one icon per app. Ten saved apps as ten rail icons would
crowd out everything else, and the rail's descriptor rule keeps generated code out of chrome. The source
lists project apps the way HTTP, Linear, and Rollbar list their rows, and a row opens a pane at a
project route under `/p/:projectId/x/`, the pattern those three plugins use ([panes](../../panes.md)).

### Workspace and project

The left rail is workspace-level, and its sources are gated per workspace. Project apps belong to a
project, because the data sources they read, the tasks they relate to, and the memory agents use are
all project-scoped. The **Apps** source lists the apps of the routed project, and shows an empty state
naming the project when there are none, as other project-scoped sources do.

Some data sources need a task. The database plugin, for one, runs queries inside a task's worktree. A
project app that reads one declares it, and its project pane offers **Open in a task** through the
reference panel's find-or-create-a-task action ([panes](../../panes.md#not-a-pane-the-reference-panel))
instead of failing.

Workspace-scoped apps are out until someone needs an app that spans projects. See
[refused](./refused.md#workspace-scoped-apps).

## Building and editing

### Tools

The host plugin gives agents seven task-scoped tools:

| Tool | Risk | What it does |
| --- | --- | --- |
| `app_create` | write | Creates a task app with a name and description, writes the starting files, and returns the app ID and file list. |
| `app_read` | read | Returns one file from the app's working copy, with its hash. |
| `app_write` | write | Replaces one file. Needs the file's current hash if the file exists. |
| `app_edit` | write | Replaces one exact string in one file, the way a coding agent's edit tool does. Fails if the string is missing or not unique. |
| `app_show` | write | Validates the working copy, publishes it as the next revision, makes it head, and draws it as a card. |
| `app_list` | read | Lists the task's apps, the project's apps, and any draft links. |
| `app_guide` | read | Returns the authoring guide: the app profile, the kit components with their properties, the bridge calls, and worked examples. |

Files go through tools rather than the agent's own file access, for four reasons:

- The files stay out of the worktree, so a task's diff never carries an app it did not ask for.
- A headless session in `auto` permission mode may be refused writes outside its working folder.
- The host sees every change, which is what makes revisions and conflict checks possible.
- `app_edit` lets the agent change three lines instead of retyping a whole file. Lemma's widget skill
  makes this argument at length: a retype is where a working widget picks up a new bug.

`app_guide` follows the rule `plugin_authoring` enforces: never answer a contract question from
memory. Its component list and bridge calls are derived from the running host
(`packages/node-core/src/server/agentTools/pluginAuthoring.ts` shows how).

### Validation before anything is shown

`app_show` never draws a probe. Before it publishes a revision it checks, in order:

1. The manifest stays inside the app profile.
2. `client.js` is at most 256 KiB.
3. The tree boots in a headless worker on the Node, renders once against empty data, and throws nothing.
4. Every component it emits is a kit component, and every property is one the component accepts.
5. It calls no bridge method outside the profile, and no data source it did not declare.

A failure returns every error to the agent and draws no card. The agent fixes the file and calls
`app_show` again. Lemma validates widget HTML before display for the same reason: a card that fails in
front of the owner costs more trust than a failed tool call the owner never sees.

### Revisions, and a history that does not lie

Each successful `app_show` publishes revision `n + 1` and makes it head. Revisions are immutable.

In Lemma, a widget shown from a file follows the file, so every earlier message that showed it
updates too. Scroll back to the fourth message and it shows the seventh version. Acorn pins instead:

- Each card records the revision it showed.
- Only the newest card for an app is live.
- Older cards collapse to one line: "v2: added a status filter. Replaced by v3." The line offers
  **Restore v2**, which publishes v2's files as a new revision.
- The task pane and project pane always run head.

Older cards do not run old code. That would mean two installed versions of one package at once, which
the plugin host does not do. A frozen picture of an old revision is a later option. See
[refused](./refused.md#live-old-revisions).

### Remixing from the app

The task pane has an **Edit with agent** drawer beside the app. It draws the conversation of the
session that built the app, composer included, through the `agents.conversation` client capability the
workflows run pane already uses (`plugins/agents/src/contract/conversation.ts`). The owner asks for a
change, the agent edits the files and calls `app_show`, and the pane moves to the new head.

If that session is gone, archived, or belongs to a different task, the drawer offers **Start an editing
session**. It creates a session in the current task with the app attached as context: its name,
description, file list, and head revision.

Two sessions can edit one app. `app_write` needs the current hash and `app_edit` needs an exact match,
so the second writer gets a conflict and reads the file again.

## What an app can reach

An app has no node half, no network, no secrets, no processes, and no frames. It reaches the rest of
Acorn through a closed list of bridge calls, each checked by the host:

| Call | What it gives the app | Notes |
| --- | --- | --- |
| Data sources | List, describe, query, and read details of the typed data sources the manifest declares | The shared, Node-owned read contract that dashboards and workflows use ([data sources](../../data-sources.md)). |
| Row actions | Run a record's host-dispatched action | The host draws the risk confirm and refuses non-HTTP action URLs, as it does for dashboards. |
| Task context | Read the task's assembled context | Read only, and only for the task the app is drawn in. |
| Compose | Put text in the conversation composer | The owner sends, edits, or ignores it. An app never sends a message. Lemma's widgets follow the same rule. |
| App state | Read and write the app's own `state.json` | See below. |

### Other plugins' capabilities

An app does not get access to every plugin's capabilities, for two reasons.

A node capability (`ctx.capabilities`) is a function one plugin's node half publishes for another
plugin's node half. An app has no node half, so there is nothing to call it from. More importantly, the
security model rests on each bundle declaring what it reaches and the owner seeing that at trust time
(`permissions.node.capabilities` in [the manifest](../../plugin-authoring/the-manifest.md)). Blanket
access would make a prompt-injected agent's app as powerful as the most powerful plugin on the Node.

Data sources are the answer instead. They are already how one plugin's records reach another's
surfaces without either importing the other. A plugin that wants its data usable in apps registers a
source, and every app can declare it. Agents can already find sources with `data_sources_discover` and
`data_source_describe`.

What the app reads is also what the agent could already read through its own data tools, so the
profile adds no new read path, only a way to draw it.

### Dependencies

The manifest declares every data source the app uses, by `(pluginId, sourceId)`, and the host enforces
the list. The plugins behind those sources are the app's dependencies.

- If a plugin an app depends on is disabled or missing, the app shows an unavailable state that names
  it, as a dashboard panel does. It never guesses a schema or shows an empty result.
- Export writes the same list into the plugin's `requires.plugins`, with each plugin's running major
  version as the range.

### App state

Some apps need to remember something: which checklist items are done, which rows are dismissed, a
filter the owner chose. The host keeps one JSON document per app, at most 256 KiB, read and written
through the bridge. A project app's state is shared by everyone who opens it in that project. A draft
starts with a copy of the project app's state.

## Trust

Every plugin bundle runs on a device only after that device accepted its exact hash
([security](../../security.md)). An app that changes on every `app_show` would prompt on every
revision. Dev mode solved the same problem for plugins an agent writes: an owner grant makes the helper
record acceptances for new hashes without prompting, marked so they can be revoked
([activation](../../plugins/activation.md)).

App trust reuses that mechanism with a narrower scope:

- It covers only the reserved app ID prefix on one Node, and only manifests inside the app profile.
  A manifest that asks for more is refused by `app_show` and would still prompt on the device.
- The first app on a device asks once: "Let agents build apps on NODE_NAME. Apps can read the data
  sources they declare and ask you before any action. They cannot reach the network."
- **Settings > Plugins** shows the grant, and **End app trust** removes it and every acceptance it
  wrote, so every app goes back to the ordinary per-hash prompt.

The argument for the grant is the profile. With no node half and no network, the worst an app can do
is draw something misleading, offer text into the composer, or ask the owner to confirm a row action.
That is less than the agent that wrote it can already do. The grant is still a security decision, and
phase 1 needs a security review before it ships.

## Lifecycle

### Archive and restore

Archive keeps every plugin's rows and restore brings the task back
([restoring a task](../../workspaces-and-tasks/archive.md#restoring-a-task)). Task apps follow the task:

- The archive confirmation lists the task's apps: "2 apps belong to this task. They are archived with
  it and come back if you restore it." Each has **Publish to project** beside it.
- Archive unregisters the task's apps. Their files and revisions stay.
- The archived task preview's Apps pane lists the apps, their revisions, and their source, read only.
  It does not run them, because an archived task has no worktree and its data may not resolve.
- Restore registers them again.
- A draft of a project app is a task app. Archiving its task leaves the project app alone.

### Publish and promote

**Publish to project** makes a task app a project app. The first publish is what "promote" means.
Afterwards, the task app becomes a draft linked to the project app, so the owner can keep iterating in
the same task and publish again.

Publishing a draft replaces the project app's head with the draft's head, provided the project app has
not moved since the draft started. If it has, the owner chooses between **Publish as a new app** and
**Replace anyway**. This is a pull request for an app, without the review.

### Forking a project app

Editing needs an agent session, and sessions belong to tasks, so editing a project app needs a task.
**Edit** on a project app offers:

- **Edit in this task**, when a task is open. The draft lands in that task.
- **Edit in a new task**, which creates a task named after the app with the draft in it.

A new task creates its worktree when its first session starts. That is heavy for editing a UI. See
[the open questions](./README.md#open-questions).

### Deleting

Deleting a project app hides it from the rail and moves it to an **Archived apps** list on the Apps
page, where it can be restored or removed for good. A task app is deleted with its task only when the
task is.

## Export as a plugin

**Export as plugin** writes a plugin package folder: the head revision's files, a plugin ID the owner
chooses outside the reserved prefix, and `requires.plugins` from the declared data sources. The owner
installs it like any hand-written package, through the normal trust prompt, and can then add a node
half, routes, settings, or anything else a plugin can do. The app stays until the owner deletes it.

## In the terminal client

Trees draw in the terminal through a `node:worker_threads` sandbox
([security](../../security.md)). The authoring guide lists only kit components that have a terminal
rendering, and `app_show` validates against both hosts. Cards in the terminal transcript cap their
height in rows and offer the same **Open** into the task pane.

## Cost and performance

Each mounted app is one worker. The newest card per app is the only live card, and a card mounts its
worker only when it scrolls into view. Measure the cost of a worker per app in phase 0, because a
transcript with ten apps could otherwise hold ten workers.

## Security summary

| Threat | What bounds it |
| --- | --- |
| A prompt-injected agent writes an app that leaks data. | No network. Data leaves only through row actions the owner confirms, and those accept only HTTP URLs. |
| An app acts without the owner. | Row actions show the host's risk confirm. Compose never sends. |
| An app reads more than it should. | Only declared data sources, only the task it is drawn in, and nothing the agent could not already read. |
| A Node serves hostile app code. | App trust is per Node and per device, covers only the app profile, and ends with one action. |
| A teammate's app runs on my device. | Each device grants app trust on its own. See [phase 5](./05-teams.md). |

## Lessons taken from Lemma

- Edit files, not tool arguments. Taken, through `app_write` and `app_edit`.
- Never show a probe. Taken, as validation in `app_show`.
- Give the agent a design vocabulary and examples. Taken, as the kit and `app_guide`. Lemma's agent
  pastes a CSS token block and adapts six example widgets. Acorn's agent names kit components, which
  is a smaller and safer vocabulary.
- Cap the inline height. Taken: cards cap at 480 pixels with **Expand**.
- A widget offers a message and never sends one. Taken, as the compose call.
- Widgets and apps are one primitive. Taken further: one package from the start.
- A shown widget follows its file. Refused: cards pin revisions.

## Verify before building

- That a remote tree contributed to `agents:tool-card` can host another plugin's remote tree through a
  slot, or what the tool card needs instead. The point is declared in `plugins/agents/src/client/index.ts`.
- That the Node can boot a tree headlessly for validation. The terminal client runs trees in workers,
  so the runtime exists, but it may live in the client packages only.
- The plugin ID rules, and whether a reserved prefix can be excluded from the installed list.
- Whether a tree's bridge can reach `/v1/core/data-sources` today, and under which grant scope.
- How dev mode records acceptances, so app trust can reuse the code rather than copy it.
- How HTTP, Linear, and Rollbar list project-scoped rows in a left-rail source.
