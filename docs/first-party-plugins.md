# First-party plugins

This page audits the compiled plugins under `plugins/`: which are first-party because they have to be,
and which only because they were written before there was another option. Read it before you move a
plugin between tiers or add a compiled one. [Extensibility](./extensibility.md) explains why the two
tiers exist.

A compiled plugin is registered in the Node or desktop composition, ships inside the binary, runs in
the shell's own realm, and is trusted like the rest of the app. Being in the binary isn't a privilege.
What makes a plugin first-party is using something a loaded plugin can't be given.

The compiled plugins are agents, browser, context, docker, editor, git, github, memory, notes,
onboarding, preview, terminal, and workflows. agent-cost, database, http, linear, model-providers,
rollbar, and sentry-telemetry ship as loaded packages, and nodes-file is a loaded package that isn't
bundled. All of them live in `plugins/` as source.

## What a loaded plugin can't have

Every row in the tables below cites one or more of these reasons:

- **A. WebSocket stream and channel ownership,** through `ctx.events.streams()` and
  `ctx.events.channel()`. Exactly one plugin may own the PTY stream handlers, and the WebSocket hub's
  slots are module singletons. These are pieces of the transport, not consumers of it.
- **B. In-realm components inside another surface's tree,** such as overlay slots, the terminal
  drawer, and the task footer. The host holds the component and calls it inside its own JSX. This
  shrank once trees arrived: a card in a transcript, a section in another tray, or a panel body is an
  extension point a loaded plugin fills with a tree. What's left is places the host hasn't opened as a
  point, places that hold a live stream, and components that must share a render tree with their host,
  such as a first-run wizard that exists before any plugin is trusted.
- **C. Code that runs in the desktop shell itself.** The shell surface is enumerated and
  boundary-tested, and a loaded plugin has no presence there. This category is empty, but the rule
  stays, because the next thing that needs a window should land first-party.
- **D. Publishing a capability the shell or core depends on.** These are the required plugins: they
  can't be disabled, so they can't be optional, so they can't be third-party.
- **E. Registries with no manifest form,** such as `persistedStateSlices`, component slots other than
  the footer, and `ctx.contribute(registry, entry)`. Some are inherently first-party, and others have
  no declarative form yet. What a loaded plugin gets is `NodePluginContext` and `ClientPluginContext`,
  and everything here sits on the compiled types beside them.
- **F. Constructor arguments from the composition root,** the `NodePluginDeps` bag in
  `apps/node/src/composition/plugins.ts`. A loaded plugin is handed only its context. agents, notes,
  terminal, and workflows take a dependency bag, and agents, memory, and notes take the data root for
  files they write outside SQLite. None of them is here only for F.
- **G. A native dependency.** A loaded package is one bundled entrypoint with no `node_modules`, so a
  module with native parts can't travel with it. `playwright-core` and `node-pty` are the cases.

Hono routers aren't on this list. Compiled plugins register routes with `ctx.routes.register`, which
loaded plugins don't get, but that's a carrier difference ([the honest asterisk](#the-honest-asterisk)).
Owning a SQLite file, agent tools, integration providers, panes, reference panels, sources, settings
pages, slots, attention items, Node stats, content links, and webviews are all available to loaded
plugins.

## Must be first-party

| Plugin | Why | Reason |
| --- | --- | --- |
| **terminal** | Owns the PTY stream handlers and a WebSocket channel prefix, and carries `node-pty`. It's required, publishes capabilities four other plugins consume and `TERMINAL_RUNTIME`, whose tmux reconcile the composition root runs, handles the `core:worktree-created` hook, contributes two component slots and the `terminal:command` and `terminal:run-target` workflow step kinds, and is the most privileged plugin | A, B, D, F, G |
| **agents** | Required. Publishes `MANAGED_AGENTS`, `AGENTS_RUNTIME`, `AGENTS_SESSION_EXECUTE`, `AGENT_USAGE`, and the harness registry, and owns the managed-agent session model that core's context assembler and the transcript both read | D, E, F |
| **docker** | Owns a WebSocket channel prefix for container log and event streams. Its footer badge is a component contribution | A, B |
| **memory** | Required. Publishes `KNOWLEDGE` and `MEMORY_KNOWLEDGE`, and contributes task-context sections core's assembler depends on | D, F |
| **notes** | Required. Publishes `NOTES_STORE` and `NOTES_SEED_TASK`, consumed by two other plugins, and contributes a context section | D, F |
| **onboarding** | A component in the `overlay` slot: the first-run wizard, opened when the Node is ready and has no projects. A trust prompt for a plugin the person never installed would be circular. Its **Generate with AI** step reads `GET /v1/core/models/backends`, and **Next** is never blocked | B, D |

## First-party for one specific reason

| Plugin | Why | Reason |
| --- | --- | --- |
| **browser** | Drives an installed Chrome with Playwright, and `playwright-core` brings a driver and native parts a single bundle can't carry. It isn't required: a Node with no browser loses six agent tools and nothing else | G |
| **preview** | Its pane uses the host-owned native preview service and contributes the `terminal.previewRecipeSelection` client capability and an address-bar extension point. It stays compiled as the built-in task preview | — |
| **git** | Nothing keeps it here. Its source and task pane use the shared kit and public Node services, and its `LOCAL_GIT` capability is open to loaded plugins. It stays compiled by preference as the built-in Git client on both hosts, and its Changes tab is one of the panes every task has | — |
| **github** | Publishes `GITHUB_MIRROR`, which has consumers. Its content links have a manifest form, and its five surfaces are host layouts filled with kit nodes, with no stylesheet. It isn't required | D |
| **workflows** | Publishes `WORKFLOWS_RUNNER` and `WORKFLOW_ROUTE`, registers a client capability, and declares the two points other plugins add step kinds and policies through. All its UI is kit nodes with no stylesheet | D, E, F |
| **context** | Contributes a `persistedState` slice. Its agent context's synchronous `revision()` keys the automatic task-context snapshot, and a descriptor can't answer synchronously | E |
| **editor** | Owns the `editor:pty:*` channel for `$EDITOR` mode and the persisted open-file slice. Its file tree is a multi-document surface, and the loaded `document` layout describes one document at a time. On September 11, 2026, `pnpm --filter @acorn/node measure:editor-bundle` measured its pane at 1,271,605 raw bytes, so size isn't a blocker | A, E |

No plugin is first-party only by history. The editor was the last, and it moved to the table above for
reasons A and E.

## The honest asterisk

Every route-owning compiled plugin registers routes with `ctx.routes.register`. Loaded plugins get only
`fetch`, and Rollbar is a standing production caller of that seam. On routes, most plugins above are
first-party because of the carrier they were written against, not because of anything about them.

The fetch seam is complete. It carries a `PluginRequestContext` with the authenticated identity and a
provider runtime, so a loaded plugin serves provider routes without seeing Hono, the core database, or
the secret service. Passing a Hono router to `ctx.providers.integration` is an initialization error.

`persistedState` has no manifest form, which makes `context` and `editor` look more privileged than
they are, and neither does a component slot outside the task footer. Keybindings and agent contexts
used to be gaps and aren't: loaded plugins declare `commands` and `keybindings`, and an
`agentContexts` descriptor names two routes the host fetches.

## What the apps import from plugins

An app may import any plugin's `node/index.ts` and `client/index.ts`, because composition roots exist
to register plugins. An import from a plugin's `contract/` folder is different: it means an app depends
on that one plugin. Each one is listed here and in `tools/arch/boundaries.test.ts`, which fails on an
import missing from its list and on a listed import that's gone. Add the reason in both places.

- **CLI and agents.** The built-in `agent` commands and `projection.ts` read the session, turn, event,
  and provider shapes from `wire.ts`. [Agents and workflows](./cli/agents-and-workflows.md#why-these-commands-are-built-in)
  says why those commands aren't a `cliCommands` contribution. The browser extension's native bridge
  (`browser/agents.ts` and `browser/bridge.ts`) relays managed sessions, and also reads `appApproval`,
  `lifecycle`, `sessionModel`, and `newSessionChoices`. `browser/workflows.ts` reads a run's agent
  sessions from `wire.ts`.
- **CLI and workflows.** The built-in `workflow` commands read the run, step, and definition shapes from
  `wire.ts`. The native bridge (`browser/bridge.ts` and `browser/workflows.ts`) relays the same shapes.
- **Desktop and terminal.** `TaskView.tsx` opens a terminal profile through `sessionsClient`, the create
  and list half of terminal's client, so the shell can't write to, attach to, or kill a session.
- **Extension and agents.** The sidebar draws a session's state with `runtimeState`, marks the Agents
  tab, each task row, and a conversation's state line with it, and registers the harness marks from
  `providerMarks`.
- **Extension and workflows.** The sidebar prefills a workflow's inputs from the page's item, and
  parses and checks the inputs of a start in a task, with `itemInputs`. It draws runs and steps with
  `statusDisplay`.
- **Node and three plugins.** `composition.ts` runs agents', terminal's, and workflows' startup
  reconcile through their `runtime` and `runner` capabilities.
- **Terminal client and terminal.** `Sessions.tsx` and `sessionPty.ts` draw the terminal drawer
  themselves, so they read `hostClient`, `wire`, and `toolbarActions`. The drawer stays in the shells
  for reason B above. Its open, maximized, and focus state is client-core's (`setTerminalOpen`,
  `isTerminalMax`, `consumeTerminalFocusIntent`), because both shells and terminal's own panel read it.
  That state moves to terminal if the drawer ever does.
- **Terminal client and agents.** `Sessions.tsx` hands a terminal session back to managed mode through
  `handoffClient`.
- **Terminal client and workflows.** `Shell.tsx` hosts the launch-from-commit dialog Git opens, through
  `gitLaunch`.

## Rules of thumb

**When a new plugin should be first-party:** it owns transport, renders inside another surface's
component tree, needs to run in the shell, carries a native dependency, or the shell can't start
without it. "It's ours" isn't a reason. GitHub stopped being required and nothing broke.

**When an existing one should stay put:** always, unless there's a reason beyond proving a point.
Converting a working integration to exercise a seam mixes up "did the seam work" with "did the port
work". Prove seams with a plugin that has to keep working.

**When a third-party plugin asks for a first-party privilege:** the path is review and adoption into
first-party, not a wider sandbox. The tiers are permanent, and the line is whether a contribution can
be expressed as data plus asynchronous messages.

## Related

- [What each of these loses in a terminal](./first-party-plugins/terminal.md).
- [Plugins to copy](./first-party-plugins/examples.md): the plugins that follow third-party rules.
- [Compiled tier](./future/compiled-tier.md): the per-plugin plan for shrinking the compiled tier.
