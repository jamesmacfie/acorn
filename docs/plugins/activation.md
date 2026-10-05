# Activation

This page covers how the Node and the client start plugins, what a plugin can register, and what the
owner sees and controls under **Settings > Plugins > Installed**. It's part of the
[plugin reference](../plugins.md).

## Activation

`apps/node/src/composition/plugins.ts` is the Node activation list, and
`apps/desktop/src/client/plugins.ts` is the client activation list. The host validates unique names,
applies the per-Node disabled-plugin set, initializes enabled plugins, runs the optional `ready`
pass, and owns disposal of their registrations.

Four plugins are required: agents, memory, notes, and terminal. They declare `required: true` and
can't be disabled. Every other plugin can be disabled per Node. Its SQLite file stays on disk, so you
can enable it again later. GitHub is optional. With it disabled, core Home and the other plugins still
boot.

The Node runs every plugin's `init` concurrently, then every plugin's `ready`, before the listener
accepts requests. Declaration order isn't a contract. A plugin whose `init` reads what another
plugin's `init` registered has a bug. Use one of two answers instead:

- Resolve a capability at call time, inside the closure that needs it, with `ctx.capabilities.get`.
- Read another plugin's contributions in `ready`, which runs after every `init` has finished.

A loaded plugin that names another in `requires.plugins` initializes after it. `initPlugins` checks
order independence with a test: it initializes one roster in declaration order, reversed, and
shuffled, and asserts the same registrations each time
(`packages/node-core/src/server/pluginHost/host.test.ts`).

Failure is per plugin. A compiled plugin that throws in either pass fails the boot. Every plugin that
did initialize is disposed first, because each holds a write-ahead-log SQLite handle and the
composition root releases the data-root lock on the way out. A plugin loaded from disk is contained
instead: its registrations roll back, its roster row reads `failed`, and the other plugins reach
`ready` ([failures are contained](./loaded-plugins.md#failures-are-contained)).

## What a plugin registers

A plugin can register:

- Routes under `/v1/p/<plugin>/`.
- Typed capabilities.
- Client broadcasts through `ctx.events`.
- Agent tools and task-context sections.
- Integration, connection, model-provider, and node-provider descriptors.
- A plugin-owned SQLite migration chain and a disposal hook.

Node actions and managed-agent harnesses aren't registered by plugin code. The manifest declares
them, as a command whose verb is `runNodeAction` and as `contributions.harnesses`, and the host
replays them through `HostPluginContext`.

`ctx.log` writes a line with the plugin id bound, sends it to every subscribed telemetry sink, and
passes it through the scrubber. A `console.error` with a typed prefix does none of that
([logging](../telemetry/logging.md)). `ctx.telemetry` records spans, counts, gauges, and errors about
the plugin's own work. Neither needs a permission.

## What the host supplies

The host supplies `CoreServices` for confined filesystem access, Git, processes, secrets, tasks,
projects, task context, model generation, preferences, and the machine identity. Plugins don't get
the core database handle to query shared tables.

`CoreServices` returns a projection of a core entity, never the row. `projects` answers with
`ProjectRef`: id, name, path, workspace, and the GitHub facet. `tasks` answers with `TaskRef`: id,
title, `projectId`, branch, `worktreePath`, and `pullNumber`. Renaming a core column therefore
can't break a plugin. `taskContext()` and the `core:worktree-created` hook take a `TaskRef` too, so a
plugin can hand back what it was given.

There's no HTTP client on `CoreServices`. [HTTP client](../http-client.md) explains why.

## What the owner sees

**Installed** follows the settings header's Node switcher. Which plugins a Node runs decides which
routes exist and which SQLite files it opens, so disabling a plugin is a statement about one machine.
There's no "install everywhere" or "disable everywhere". The client-only plugins this device holds
are listed beside the Node's, because they belong to the device whatever the header names.

The list has three filters:

- **All** shows every plugin.
- **Needs you** shows what only the owner can settle: a bundle waiting for approval on this device, a
  package waiting for review, inputs waiting for approval, a failed load, and a change that waits for
  a Node restart.
- **This device** shows the client-only plugins.

Each row names the plugin and states its version, origin, and status in the words
`host/plugins/pluginStatus.ts` computes. The plugin strip and the attention rows use the same words.
The waiting states raise attention rows (`infra/node/pluginFailures.ts`), and those rows put the dot
on **Installed** in the settings rail.

A row shows the plugin's name, such as "GitHub", not its id. A compiled plugin sets `label` in its
`NodePlugin` definition, and a loaded or device-held plugin uses its manifest `name`. The client reads
it through `pluginLabel` and falls back to the id when a Node sends no label. The id still shows on
the **Status** line, in every trust prompt and review, and in the audit log.

**Manage** opens the plugin's page. For a plugin waiting for you to approve what it reads, it opens
that prompt instead ([approving what a plugin reads](./distribution.md#approving-what-a-plugin-reads)).
The page has an **Enabled** switch, a status banner, and four tabs:

- **Overview**: what the plugin adds on this device, such as rail sources with their **Show in left
  rail** switch, command and shortcut counts, agent tools, the data sources it declares, and the event
  verbs it declares in `emits`.
- **Settings**: the plugin's own settings pages, each with **Open**, and any core surface it offers
  to draw.
- **Permissions**: **Reads**, one row per input its derived sources read, with the source, the
  provider, and how many published panels use it with which accounts, plus **Review…** or **Revoke**.
  The panel count is read from the Node only while this tab is open. Then the grant lines, a staged
  package's review with **Approve this package** and
  **Remove staged package**, each approval this device recorded with **Revoke approval** or **Review
  again**, and development mode with **End dev mode**. A device plugin also offers **Dev trust**.
- **Versions**: the installed and running versions, the source, and **Update**.

Uninstalling sits in a danger zone under the tabs, and each button asks through the shell's
confirmation. A Node plugin has two buttons, **Keep its data** and **Delete its data**, not a checkbox,
because a checkbox is how someone deletes a year of notes by reflex. A device plugin has **Remove**,
which also drops every preference this device kept for it. Required plugins show no switch, and a
bundled package shows neither **Update** nor uninstall.

A page shows two activation facts. `disabled` is what will happen at the Node's next start, because
routes, tables, and jobs are wired at init. `running` is what's happening now. Between saving a
toggle and restarting the Node they can differ, and the page shows both, in the plugin's status and
in a restart banner above the list. Install and update show the same banner, because a package on
the Node's disk hasn't necessarily started.

### Installing

**Install…** is one flow for both targets. The owner picks where the plugin goes, the Node in the
header or this device, then the source: a GitHub release, an npm package, a tarball URL, or a local
folder. A Node install calls `installNodePlugin`, and a device install calls
`installPluginOnDevice`. A device install offers a local folder only where the host has a folder
picker. **Choose…** appears for a Node only when it's this computer's. A folder installed on a Node
is linked, not copied, and the flow says so.

### The plugin strip

The settings view draws a strip above every page a plugin contributes, whether compiled, remote
tree, or frame, and at the top of a plugin's tab on a workspace or project page. It names the plugin
and its origin, offers **Manage plugin**, draws a **Show in left rail** switch for each source the
page names in `railSourceVisibility`, and holds the **Enabled** switch. A status line names the four
states the owner has to know about: off, waiting for approval, failed, and offline.

An off Node plugin's page stays and still saves until the Node restarts. Turning a device plugin off
from its strip removes the page at once, so the view opens the plugin's page under **Installed**
instead. For where the strip sits and why content can't cover it, see
[the plugin strip](../frontend/settings-groups.md#the-plugin-strip).
