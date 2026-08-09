# First-party plugins

acorn has two plugin tiers. This document is about the first: the seventeen packages under
`plugins/` that ship inside the binary, run in the shell's own realm, and are trusted like the
rest of the app. [plugins.md](./plugins.md) describes both tiers as they work, and `docs/security.md` holds the
trust model behind the second one.

The question this file answers is narrower and keeps coming up: **which first-party plugins are
first-party because they have to be, and which are just first-party because they were written
before there was another option?** Being in the binary is not a privilege in itself. What makes a
plugin genuinely first-party is using something a loaded plugin cannot be given.

## What a loaded plugin cannot have

Five things, and every entry in the table below cites one of them.

**A. WS stream and channel ownership** — `ctx.events.streams()` and `ctx.events.channel()`.
Exactly one plugin may own the PTY stream handlers, and the WS hub's slots are module singletons.
These are pieces of the transport, not consumers of it; there is no message-passing version of
"own the byte stream" that is not just the byte stream, slower. Never present on a loaded
plugin's context, whatever its manifest says.

**B. In-realm components inside another surface's tree** — agent-tool renderers drawn inline in a
transcript list, diff components embedded in a pane someone else owns, overlay slots. The host
holds the component function and calls it inside its own JSX. An iframe is opaque: nothing
reaches inside it and nothing inside reaches out, so it cannot be a child in another component's
render tree.

The test is *embedded in a render tree*, not *rendered by another plugin*. A **ref panel** is the
case worth being careful about: github's `PullDetail` renders linear's panel beside a PR, which
sounds like B and is not — the panel is a rectangle the host places, so `refPanel` is one of the
frame targets and a loaded plugin contributes one as a sandboxed frame
(`packages/client-core/src/plugins/frames/register.tsx`). Two of `RefPanelProps` do not survive
the boundary — `onContentClick` and the multi-ref `refs`/`onSelectRef` chip strip — so a frame
panel is single-ref and handles its own content clicks. That is the whole difference.

**C. Electron main-process code** — a `src/main/` half that imports `electron`. The desktop
surface is enumerated and boundary-tested; a loaded plugin has no main-process presence at all.

**D. Publishing a capability the shell or core depends on** — a plugin whose absence would leave
core (or the shell in front of it) with a hole it cannot degrade around. These are the `required`
plugins: they cannot be disabled, so they cannot be optional, so they cannot be third-party.

**E. Registries with no manifest form** — `agentContexts`, `persistedState`, `keybindings`,
`agentToolRenderers`, and the generic `ctx.contribute(registry, entry)` escape hatch. These take
functions or components. Some are inherently first-party (B); others simply have no declarative
equivalent yet, which is a gap rather than a law — noted per row where that is the case.

`contentLinks` used to be on this list and no longer is: a loaded plugin declares URL recognisers
in its manifest (`contentLinks: [{ match, openPane, item }]`, compiled host-side from a restricted
pattern grammar). First-party plugins still register them as functions through `ctx.contribute`,
which is a carrier difference, not a capability one.

Two things that are **not** on this list, deliberately:

- **Hono routers.** Every first-party plugin registers routes with `ctx.routes.register`, which
  loaded plugins do not get — but that is a seam gap, not a privilege. See "The honest asterisk"
  below.
- **Owning a SQLite file, agent tools, integration providers, panes, sources, settings pages,
  palette rows, slots, attention items, node stats.** All available to loaded plugins today,
  through the manifest, the frame bridge, or `ctx`.

## The plugins

Ordered by how strong the first-party claim is.

### Must be first-party

| Plugin | Why | Reason |
| --- | --- | --- |
| **terminal** | Owns the PTY stream handlers and a WS channel prefix — the transport itself. Also `required`, publishes seven capabilities (`TERMINAL_SESSIONS`, `RUN_TARGETS`, `WORKTREE_CREATED`, `TASK_CREATED`, …) that four other plugins consume, contributes two component slots, and has an Electron main half (`folderPickerIpc.ts`). It is the most privileged plugin in the tree and every reason applies at once. | A, B, C, D |
| **agents** | `required`. Publishes `MANAGED_AGENTS`, `AGENTS_RUNTIME`, `AGENTS_SESSION_EXECUTE`, `AGENT_USAGE`; owns the managed-agent session model that core's context assembler and the shell's transcript both read. `managedAgents.ts` is still in protocol because client-core's agent-tool renderer registry names it. | D, E |
| **docker** | Owns a WS channel prefix for container log and event streams. Its footer badge and rail slot are component contributions. | A, B |
| **preview** | Has an Electron main half driving `WebContentsView` (`browserService.ts`, `previewService.ts`) — native window management, not a rectangle — plus the CDP driver behind its six browser agent tools. Planned ([webview/](./webview/)): the *display* half becomes a host-owned capability any plugin can place in a surface, while the main half and the driver stay here. Preview stays first-party either way; only its monopoly on showing a web page ends. | C |
| **memory** | `required`. Publishes `KNOWLEDGE`/`MEMORY_KNOWLEDGE` and contributes two task-context sections that core's assembler depends on existing. | D |
| **notes** | `required`. Publishes `NOTES_STORE` and `NOTES_SEED_TASK`, consumed by two other plugins; contributes a context section. `notes.ts` remains in protocol because `NoteLocation` is core's own task/workspace/global addressing scheme. | D |
| **onboarding** | A component in the `overlay` slot, rendered above the whole shell before a node is configured. Sandboxing the first-run experience behind a trust prompt for a plugin the user never installed is circular. | B, D |

### First-party for one specific reason

| Plugin | Why | Reason |
| --- | --- | --- |
| **changes** | Contributes an **agent-tool renderer** — the component that draws its tool's calls inline in the agents transcript, dozens per screen, sharing the list's scroll and selection. Everything else about it (its SQLite file, its pane, its agent tool, `LOCAL_GIT`) is available to loaded plugins. | B |
| **github** | Publishes `GITHUB_MIRROR`, and uses `ctx.contribute` for its content-link recognisers — which now have a manifest form, so this is a carrier difference rather than a privilege. Notably **not** `required` any more. The most-privileged-looking plugin in the tree is now among the closest to portable; what actually keeps it here is `GITHUB_MIRROR` having a consumer. | D |
| **workflows** | Publishes `WORKFLOWS_RUNNER` and `WORKFLOW_ROUTE`; `workflow.ts` stays in protocol because client-core's notification pipeline reads the workflow row types. Registers a client capability rather than UI. | D, E |
| **context** | Contributes an `agentContexts` entry and a `persistedState` slice — two registries with no manifest form. Small plugin, narrow reason. | E |

### First-party only by history

These use nothing a loaded plugin could not be given. They are in the binary because they were
written before the loader existed.

| Plugin | What it uses | Portable? |
| --- | --- | --- |
| **rollbar** | An integration provider, a rail source with promotion, a pane. No tables, no capabilities, no streams. | **Yes, fully.** The provider-route and promotion gaps that used to qualify this are closed — see below |
| **linear** | The rollbar set plus a ref panel github renders and content-link recognisers. Publishes nothing, `required` by nothing. | **Yes, fully.** `refPanel` is a frame target and content links are declarative, so both of its apparent privileges are carrier differences |
| **http** | Its own SQLite file, a pane, a rail source, a settings page, an `agentContexts` entry. Uses `core.secrets`. | Yes, once `agentContexts` has a manifest form |
| **database** | Its own SQLite file, a pane, an `agentContexts` entry, publishes `DATABASE`. | Yes — `DATABASE` turns out to have no consumer outside the plugin |
| **editor** | Monaco pane, find-in-files over ripgrep, a component slot, `EDITOR`/`SEARCH`. | Yes — neither capability has an outside consumer; blocked on keybindings and the slot ([third-party/editor.md](./third-party/editor.md)) |
| **model-providers** | Registers connection providers and model adapters. No client half at all. | Yes — the cleanest node-only shape in the tree |

Rollbar's qualification is worth spelling out, because it was the sharpest case and is now the
best evidence the tier boundary is real. A loaded plugin can serve provider routes through
`ctx.providers.integration` with a fetch handler; it can create a task from an item and link the
item to it (`POST /v2/core/tasks/:id/links` under `core.tasks:write`, plus the `createTask`
descriptor verb); and it can declare its URL recognisers. Everything rollbar does, an outside
author can now do — the plugin stays compiled in because rewriting a working integration to prove
a point is churn, not because it needs anything.

## The honest asterisk

**Every first-party plugin registers routes with `ctx.routes.register`, and none uses
`ctx.routes.fetch`.** Loaded plugins only get `fetch`. So on the route seam, every plugin above is
"first-party" in a way that says nothing about the plugin and everything about a seam with no
production caller.

The fetch seam is no longer *incomplete* — it carries a `PluginRequestContext` with the
authenticated identity and a provider runtime, so a loaded plugin can serve provider routes
without ever seeing Hono, the core database, or the secret service; and passing a Hono router to
`ctx.providers.integration` is now an explicit initialization error rather than a silent bypass.
What remains is that no shipped plugin exercises any of it.

That still matters, and it is the same failure mode this codebase has already paid for once: the
post-implementation audit of the third-party phases found three real gaps precisely because no
production plugin walked those paths. The fetch shape is also the one that survives moving plugins
out of process, so it is the seam least affordable to leave unwalked.
Moving one of the four portable built-ins onto the loaded path is the answer
([third-party/](./third-party/)), and until something does that, treat "the seam works" as tested
rather than demonstrated.

Three smaller gaps in the same category. `agentContexts` and `persistedState` have no manifest
form, which is why `context`, `http` and `database` appear more privileged than they are. And
**keybindings** have none either — the registry, the user-override store, the conflict detection
and the Settings UI all exist and are all first-party-only, which is what
[keybindings/](./keybindings/) closes and what editor is waiting on.

## Rules of thumb

**When a new plugin should be first-party.** It owns transport (streams, WS channels), it renders
inside another surface's component tree, it needs Electron main, or the shell cannot start without
it. That is the whole list. "It is ours" is not a reason — GitHub stopped being `required` and
nothing broke.

**When an existing one should stay put.** Always, unless there is a reason beyond proving a point.
Converting a working integration to exercise a seam confounds "did the seam work" with "did the
port work", and costs a working integration while you find out. Prove seams with a plugin that has to keep working —
see [third-party/](./third-party/), which weighs that trade per candidate.

**When a third-party plugin asks for a first-party privilege.** The escalation path is review and
adoption into first-party, not a wider sandbox. The two tiers are permanent, and the line is
whether a contribution can be expressed as data plus async messages.

---

## Appendix: plugins that already follow the third-party guidelines

These four use only mechanisms a third-party plugin has, or will have once the named gap closes.
Read them as the worked examples — they are what an outside author should copy, in this order:

**model-providers** — the minimal node-only plugin. Registers connection providers and model
adapters through `ctx.providers`, no client half, no tables, no capabilities. Start here to see
how small a plugin can be.

**rollbar** — the reference integration, and the whole node half is:

```ts
export const rollbarPlugin = (): NodePlugin => ({
  name: 'rollbar',
  init: (ctx) => ctx.providers.integration(rollbarProvider, rollbar),
})
```

Everything real — codecs, sync policy, routes, panes, promotion — lives in the plugin. Copy this
for any external item source. A loaded plugin writes the same thing with a fetch handler in place
of the Hono router; the two gaps that used to make this only *nearly* portable — provider routes
and promotion — are closed; [third-party/rollbar.md](./third-party/rollbar.md) is the move.

**http** — the fullest example of a self-contained feature plugin: its own SQLite file and
migration chain, a pane, a rail source, a settings page, use-scoped secrets. The one thing a
loaded plugin could not do today is its `agentContexts` entry.

**linear** — the second integration, and the one to read once rollbar makes sense. It differs in
exactly the two places worth studying: promotion is looser (a Linear issue carries its own branch
name, so its `canPromote` asks for less than rollbar's), and it contributes a ref panel that
github's PR detail renders without importing linear. That ref panel is the clearest example of
the tier line being about *shape* rather than ownership — it looks like a first-party privilege
and is a plain rectangle a frame can host.

**database** — the same shape as http, slightly smaller, and it publishes a capability. Useful to
read alongside http to see where "self-contained" ends and "something else depends on me" begins.

Worth reading, though not portable: **changes**, for what a plugin looks like when exactly one
contribution — its agent-tool renderer — is the thing keeping it first-party.
