# First-party plugins

acorn has two plugin tiers. This document is about the first: the packages under `plugins/` that are
registered in the Node or desktop composition, ship inside the binary, run in the shell's own realm,
and are trusted like the rest of the app. Linear, rollbar, model-providers and nodes-file remain in the workspace as
source for loaded packages and are not first-party at runtime. [plugins.md](./plugins.md) describes both tiers as they work, and `docs/security.md` holds the
trust model behind the second one.

[extensibility.md](./extensibility.md) covers why the two tiers exist and what the line between
them is. The question this file answers is narrower and keeps coming up: **which first-party plugins are
first-party because they have to be, and which are just first-party because they were written
before there was another option?** Being in the binary is not a privilege in itself. What makes a
plugin genuinely first-party is using something a loaded plugin cannot be given.

## What a loaded plugin cannot have

Six things, and every entry in the table below cites one of them.

**A. WS stream and channel ownership** — `ctx.events.streams()` and `ctx.events.channel()`.
Exactly one plugin may own the PTY stream handlers, and the WS hub's slots are module singletons.
These are pieces of the transport, not consumers of it; there is no message-passing version of
"own the byte stream" that is not just the byte stream, slower. Never present on a loaded
plugin's context, whatever its manifest says.

**B. In-realm components inside another surface's tree** — overlay slots, the terminal drawer, the
task footer. The host holds the component function and calls it inside its own JSX.

This reason was much wider before the layout programme, and it has dissolved for everything a remote
tree can carry. A card in a transcript, a section in somebody else's tray, a panel body: each is an
extension point with two render paths now, and a loaded plugin fills one by naming a bundle entry the
host mounts. What is left on this list is the places the host has not opened as a point, plus the
places that hold a live stream rather than a tree.

The test is *embedded in a render tree*, not *rendered by another plugin*, and the reference panel is
the case that gets it wrong — a panel looks like the first and is really the second.
[extensibility.md](./extensibility.md) § Two tiers, permanently makes that argument in full; the
outcome for this list is that `refPanel` is one of the frame targets
(`packages/client-core/src/plugins/frames/register.ts`) and Linear ships as one, so B does not cover it.

Three of `RefPanelProps` do not survive the boundary, and the third was found by shipping it.
`onContentClick` and the multi-ref `refs`/`onSelectRef` chip strip do not cross, which costs nothing
today: a frame handles clicks inside its own document, and every host is a single-ref host — the shell's
panel host is single-slot by design, so `refs`/`onSelectRef` currently have no caller at all. If a
multi-ref host ever appears, a *frame* panel will not be able to serve it and that is a real gap, not a
detail to work around. `onClose` does not cross either — the bridge's close verb is gated to importer and
overlay surfaces — and a frame cannot `Portal` out of its iframe to draw a drawer in the first place. So the
manifest adapter draws the overlay and the dismiss control itself, using the same classes a first-party
panel would, and the shell's host adds no second wrapper. A frame ref panel supplies the body; the host
supplies the box.

There is a sanctioned alternative for the *cooperative* half of B, and it is a different shape rather
than a relaxation. A **cooperative extension point** ([plugins.md](./plugins.md) § Cooperative
extension points) lets plugin A declare a place inside one of its own surfaces that other plugins may
fill. It comes in five kinds, and two of them answer B.

The `rows` kind carries a *descriptor*: an id, a label, an icon, a badge, and a verb from the closed
set, fetched by the host from the contributor's own node route and drawn by the host in its own markup.
No component enters anyone's render tree. It is B's use case served by data, and its ceiling is a list
of things with names.

The `remote` kind carries a *tree of kit nodes*, which does stretch to a real interface. Memory's
section inside the Context pane is the worked example, and it used to be the argument for the opposite
conclusion: editable inputs, a type and a scope select, a textarea, and a two-button accept-or-reject
gate per proposal. It is a `context:section` contribution now. The thing that changed is not the
descriptor vocabulary, which is as narrow as it ever was. It is that a contributor can write against
the same closed component kit the host draws with, on either of two render paths: a compiled plugin
hands over a component and a loaded plugin hands over a bundle a worker runs. The owner writes one
`Slot` and cannot tell which answered.

What is left of B is a component that has to share a render tree with its host, not merely occupy a box
inside it: an agent-tool card sharing the transcript's scroll and selection, or a first-run wizard that
exists before any plugin is trusted.

What has no sanctioned alternative, ever, is the *uncooperative* half — B reaching into A without A
saying so. See [plugins.md](./plugins.md) § There is no uncooperative extension.

**C. Code that runs in the desktop shell itself** — a plugin half that names a shell binding.
The shell surface is enumerated and boundary-tested; a loaded plugin has no presence there at all.

This category is empty. Showing a web page stopped being an instance of it when the view service
moved into the shell and any plugin gained a `webview` surface, and driving a browser stopped being
one when `plugins/browser` started running Playwright against a browser of the node's own. The
tier survives as a rule rather than as a list, because the next thing that genuinely needs a window
should still land first-party.

**D. Publishing a capability the shell or core depends on** — a plugin whose absence would leave
core (or the shell in front of it) with a hole it cannot degrade around. These are the `required`
plugins: they cannot be disabled, so they cannot be optional, so they cannot be third-party.

**E. Registries with no manifest form** — `persistedStateSlices`, non-`footer` component slots, and
the generic `ctx.contribute(registry, entry)` escape hatch. These take functions or components. Some
are inherently first-party (B); others simply have no declarative equivalent yet, which is a gap
rather than a law — noted per row where that is the case. `agentToolRenderers` was on this list and
is not: a tool card is `agents:tool-card`, an ordinary `remote` point, so a loaded plugin declares
one in its manifest like any other extension (docs/contribution-kinds.md).

**F. Constructor arguments from the composition root** — the `NodePluginDeps` bag in
`apps/node/src/composition/plugins.ts`. A loaded plugin is activated by the loader from its manifest and
is handed one thing, its `NodePluginContext`. It is never called with arguments, so anything the
root passes positionally pins the plugin to the compiled tier no matter what else it uses. Four
plugins take a dependency bag — **agents**, **notes**, **terminal**, and **workflows** — and three
take the data root as a first argument — **agents**, **memory**, and **notes** — for the files they
write outside SQLite.

None of those five plugins is here *only* for reason F; every one of them already has an A, B, D or
E beside its name. The reason is listed anyway so that this page, `docs/future/compiled-tier.md`'s
census, and the composition root agree on the same set. If a row ever loses its other reasons, F is
what is left to answer, and the answer is the same one `pluginDeps.ts` already names in a comment:
invert the dependency the way agents and workflows did, or publish it as a capability.

Two entries have come off this list, and both by the same route — the registry took functions, but
its contract was already data-in/data-out, so a descriptor could carry it.

`contentLinks` was the first: a loaded plugin declares URL recognisers in its manifest
(`contentLinks: [{ match, openPane?, item }]`, compiled host-side from a restricted pattern grammar).
That grammar has one sharp edge worth knowing before you write a `match`: it is exact-arity, with no
tail wildcard, so a URL shape with an optional trailing segment needs one entry per arity. Linear's
issue URLs come in both forms and it declares two. `openPane` is optional because the plugin's own
reference panel is the other destination, and a plugin can have items worth glancing at and no task
pane at all — but at least one of the two must exist, or the manifest is rejected. The panel is never
named in the manifest: the host stamps the plugin id onto every recogniser it registers and resolves
the panel by provider, which is what stops a manifest pointing a link at someone else's panel.

`agentContexts` is the second. A descriptor names two routes on the plugin's own node half —
`options` (GET) and `capture` (POST) — and the host performs both fetches, binds `source` from the
plugin id, stamps the capture time, and measures the snapshot bytes itself against the shared
512 KiB ceiling. Only `revision?()` did not survive, and deliberately: it is synchronous, and a
descriptor answers across a fetch.

First-party plugins still register both as functions, through `ctx.contentLinks` and
`ctx.agentContexts`, which is a carrier difference, not a capability one. Neither goes through
`ctx.contribute` any more: as of 2026-08-27 that escape hatch is for a registry another PLUGIN
published, and a registry the host owns gets a named member instead.

Two things that are **not** on this list, deliberately:

- **Hono routers.** Every first-party plugin registers routes with `ctx.routes.register`, which
  loaded plugins do not get — but that is a seam gap, not a privilege. See "The honest asterisk"
  below.
- **Owning a SQLite file, agent tools, integration providers, panes, ref panels, sources, settings
  pages, palette rows, slots, attention items, node stats, content links, and a host-owned
  webview.** All available to loaded plugins today, through the manifest, the frame bridge, or
  `ctx`. The webview is the newest and the one most likely to be assumed unavailable: a plugin
  declares a surface with a host allowlist and drives it with four verbs, while the
  `WebContentsView`, the allowlist enforcement and the CDP decision stay with the host.

## The plugins

Ordered by how strong the first-party claim is.

### Must be first-party

| Plugin | Why | Reason |
| --- | --- | --- |
| **terminal** | Owns the PTY stream handlers and a WS channel prefix — the transport itself. Also `required`, publishes six capabilities (`TERMINAL_SESSIONS`, `RUN_TARGETS`, `TASK_CREATED`, …) that four other plugins consume, handles the `core:worktree-created` hook, and contributes two component slots. It is the most privileged plugin in the tree. | A, B, D, F |
| **agents** | `required`. Publishes `MANAGED_AGENTS`, `AGENTS_RUNTIME`, `AGENTS_SESSION_EXECUTE`, `AGENT_USAGE`, `AGENTS_HARNESS_REGISTRY`; owns the managed-agent session model that core's context assembler and the shell's transcript both read, and the harness seam that lets a loaded plugin add an agent as data (docs/managed-agents.md § Harnesses). `managedAgents.ts` is still in protocol because the `agents:tool-card` point's props name it. | D, E, F |
| **docker** | Owns a WS channel prefix for container log and event streams. Its footer badge and rail slot are component contributions. | A, B |
| **preview** | Its display lifecycle calls the host-owned webview service any plugin surface can use, and its node half owns the preview page rules the shell enforces, delivered over the service protocol. The browser agent tools left for `plugins/browser`, which drives a browser of the node's own. Supplying shell-enforced policy—not merely showing a page—is why preview remains first-party. | C |
| **memory** | `required`. Publishes `KNOWLEDGE`/`MEMORY_KNOWLEDGE` and contributes two task-context sections that core's assembler depends on existing. | D, F |
| **notes** | `required`. Publishes `NOTES_STORE` and `NOTES_SEED_TASK`, consumed by two other plugins; contributes a context section. `notes.ts` remains in protocol because `NoteLocation` is core's own task/workspace/global addressing scheme. | D, F |
| **onboarding** | A component in the `overlay` slot: a full-screen first-run wizard, opened when the node is ready and has zero projects. Sandboxing the first-run experience behind a trust prompt for a plugin the user never installed is circular. | B, D |

### First-party for one specific reason

| Plugin | Why | Reason |
| --- | --- | --- |
| **changes** | Nothing keeps it here. Its tool card is a contribution to `agents:tool-card`, an ordinary `remote` point a loaded plugin can fill, and everything else about it (its SQLite file, its pane, its agent tool, `LOCAL_GIT`) was already available. It stays compiled by preference: it is one of the four panes a task always has. | — |
| **github** | Publishes `GITHUB_MIRROR`, and uses `ctx.contentLinks` for its content-link recognisers — which now have a manifest form, so this is a carrier difference rather than a privilege. Notably **not** `required` any more. Every one of its five surfaces is a host layout filled with kit nodes and it ships no stylesheet, so nothing about how it draws itself keeps it here: what does is `GITHUB_MIRROR` having a consumer. | D |
| **workflows** | Publishes `WORKFLOWS_RUNNER` and `WORKFLOW_ROUTE`; `workflow.ts` stays in protocol because client-core's notification pipeline reads the workflow row types. Registers a client capability rather than UI. | D, E, F |
| **context** | Contributes a `persistedState` slice, which has no manifest form. Its `agentContexts` entry no longer counts — that has a descriptor now — but its `revision()` does: the composer reads it synchronously to key the automatic task-context snapshot, and a descriptor cannot answer synchronously. Small plugin, narrow reason. | E |

### First-party only by history

These use nothing a loaded plugin could not be given. They are in the binary because they were
written before the loader existed.

| Plugin | What it uses | Portable? |
| --- | --- | --- |
| **editor** | Monaco pane with find-in-files (ripgrep) folded into its sidebar, an `overlay` component slot, a `persistedState` slice, `EDITOR`/`SEARCH`. Both surfaces are host layouts filled with kit nodes and it ships no stylesheet. | **One blocker, and it is Monaco's size rather than a question.** A Monaco frame bundle measured 7.93 MiB against the 8.00 MiB cap with no editor UI in it, and its four language-service workers, another 14.58 MiB, cannot be delivered at all: a plugin origin serves one file and the frame CSP has no `worker-src`. So a Monaco frame would run with no TypeScript, JSON, CSS or HTML diagnostics, which for an editor is a different product rather than a degraded mode. Neither capability has an outside consumer. |

**http** used to head this table and has moved. It was the first table-owning plugin to go, which is why
it was chosen: it is the only candidate that exercises the whole storage path, and the part nothing had
tested — a migration arriving through an installer update against a populated database — now has a test.
Read [docs/loaded-plugin-migration.md](./loaded-plugin-migration.md) for what it cost and what it found —
including two bugs that had nothing to do with the tier; the per-finding detail is in `git log`.

**database** followed it, and it is the more interesting of the two. It was the entry that read "no, on
the client half" here, because the pane embeds Monaco and Monaco does not fit a frame. The answer was
not to widen the sandbox: the host now owns one editor and lends it through a declarative contract, so
the pane still has a real editor while the plugin ships 156 KB and no Monaco at all
([docs/loaded-plugin-migration.md](./loaded-plugin-migration.md) § database has moved). Its `DATABASE` capability turned out to be
an indirection with nothing on the other side of it and was deleted rather than ported.

**model-providers** also used to be on this table and has moved: it is a loaded package now, in neither
composition list. It was the easiest possible second move and worth saying why — no client half, so
no bundle to trust and no prompt to answer; no routes, so nothing to convert to the fetch carrier;
no tables, no capabilities, and no `secrets` grant, because core resolves the stored credential and
hands the adapter a key. The whole migration was one manifest row and four deletions, which is what
"portable" should feel like when nothing is in the way.

**linear** has moved too, and it was the opposite kind of move: the only one so far that exercised a
frame ref panel and declarative content links, and the only one that came back with a capability
genuinely lost rather than reshaped. Its answer to "portable? yes, fully" turned out to be almost
right. The pane, the ref panel, the recognisers, the rail rows and host-owned promotion all crossed;
the browse's **workspace project picker** did not, because choosing which Linear projects a workspace
follows writes core's workspace state, and that write is unmappable on the frame bridge and absent
from `CoreServices`. [loaded-plugin-migration.md](./loaded-plugin-migration.md) carries the summary.

Its **project-scoped issue view** was the other loss, and that one is closed. Every frame target the
manifest had was task-scoped or modal, so the issue detail Linear used to render at `/p/:projectId`
through a `SourceRouteContribution` had no manifest form, and every rail row click outside a task was
refused with "open a task first". Panes now declare a `scope`, a manifest may declare `routes` under a
host-minted `/p/:projectId/x/<plugin-id>/` prefix, and a source's `onSelect` may `navigate` to a
project-scoped surface — so the capability is carried by the tier rather than by a compiled exception.
The picker remains open.

Rollbar was the sharpest case and is now the best evidence the tier boundary is real. Its loaded
package serves provider routes through
`ctx.providers.integration` with a fetch handler; it can create a task from an item and link the
item to it through the host-owned descriptor promotion flow. Everything Rollbar does, an outside
author can now do. Review findings from the move are in [loaded-plugin-migration.md](./loaded-plugin-migration.md).

## The honest asterisk

**Every remaining route-owning first-party plugin registers routes with `ctx.routes.register`.**
Loaded plugins only get `fetch`; Rollbar is the standing production caller of that portable seam. So on the route seam, most plugins above are
"first-party" in a way that says nothing about the plugin and everything about which carrier they
were originally written against.

The fetch seam is no longer *incomplete* — it carries a `PluginRequestContext` with the
authenticated identity and a provider runtime, so a loaded plugin can serve provider routes
without ever seeing Hono, the core database, or the secret service; and passing a Hono router to
`ctx.providers.integration` is now an explicit initialization error rather than a silent bypass.
Rollbar now exercises provider fetch routes, descriptor chrome, project scoping, promotion, client
distribution and frame rendering as production code. Its move found and closed two carrier gaps that
fixtures had missed, which is exactly why the seam needed a standing caller.

Two smaller gaps in the same category. **`persistedState`** has no manifest form, which is why
`context` and `editor` appear more privileged than they are, and neither does a component slot
outside the task footer. Both **keybindings** and **`agentContexts`** used to be on that list and no
longer are: loaded plugins declare `commands` and `keybindings` in the manifest with a frame
forwarding unclaimed chords to the shell dispatcher
(`docs/command-palette-and-shortcuts.md`), and an `agentContexts` descriptor names two routes the
host fetches on the plugin's behalf. That last one is what unblocked `http` and `database`.

## Rules of thumb

**When a new plugin should be first-party.** It owns transport (streams, WS channels), it renders
inside another surface's component tree, it needs to run inside the shell, or the shell cannot start without
it. That is the whole list. "It is ours" is not a reason — GitHub stopped being `required` and
nothing broke.

**When an existing one should stay put.** Always, unless there is a reason beyond proving a point.
Converting a working integration to exercise a seam confounds "did the seam work" with "did the
port work", and costs a working integration while you find out. Prove seams with a plugin that has to keep working —
see [loaded-plugin-migration.md](./loaded-plugin-migration.md), which weighs that trade per candidate.

**When a third-party plugin asks for a first-party privilege.** The escalation path is review and
adoption into first-party, not a wider sandbox. The two tiers are permanent, and the line is
whether a contribution can be expressed as data plus async messages.

---

## Appendix: plugins that already follow the third-party guidelines

These worked examples use only mechanisms a third-party plugin has, or will have once the named gap closes.
Read them as the worked examples — they are what an outside author should copy, in this order:

**model-providers** — the minimal loaded plugin, and node-only. Registers connection providers and
model adapters through `ctx.providers`, no client half, no tables, no capabilities, no `secrets`.
Build it with `pnpm --filter @acorn/node build:plugin model-providers`. Start here to see how small a
plugin can be: a manifest with two egress hosts and an empty `contributions`, and 33 lines of node
half.

**nodes-file** — smaller than model-providers, and the only plugin here that contributes nodes rather
than data. One registration through `ctx.providers.nodes`, a manifest that grants it nothing at all
(`core: []`, `secrets: false`, `exec: false`, `net: []`), no routes, no tables, no client half. It reads
nodes out of a JSON file named by `ACORN_NODES_FILE` and does nothing when that is unset. Build it with
`pnpm --filter @acorn/node build:plugin nodes-file`.

Read it for the acceptance argument rather than the feature: a first-party control-plane plugin gets no
host privilege a third party lacks ([plugins.md](./plugins.md) § Node providers), and this is what
"no privilege" looks like written down. It is not in the bundled roster, so a shipped install has no
node providers at all.

**rollbar** — the loaded reference integration. Its node half chooses the portable fetch carrier,
and its client half is a sandbox bundle rather than a `ClientPlugin`. Build it with
`pnpm --filter @acorn/node build:plugin rollbar`; [loaded-plugin-migration.md](./loaded-plugin-migration.md) records what the
move exposed. The provider registration remains conceptually:

```ts
export const rollbarPlugin = (): NodePlugin => ({
  name: 'rollbar',
  init: (ctx) => ctx.providers.integration(rollbarProvider, createRollbarFetch(ctx.core.projects)),
})
```

Everything real — codecs, sync policy, routes, frame and descriptor projection — lives in the
plugin. Copy this loaded shape for an external item source.

**http** — the fullest example of a self-contained feature plugin, and a LOADED one now: its own SQLite
file and migration chain staged inside its package, three frame surfaces in one bundle, a descriptor rail
source, use-scoped secrets, and an `agentContexts` entry served by two of its own routes. Read it for the
storage seam in particular; it is the only plugin that uses `ctx.storage`.

**linear** — the second integration, and the one to read once rollbar makes sense; also a loaded
package now rather than a first-party one, so read it for the same reason and expect the same shape.
It differs from rollbar in exactly the two places worth studying: promotion is looser (a Linear issue
carries its own branch name, so the rail ROW names the branch and the host's modal has nothing left
to demand), and it contributes a ref panel that a PR opens without importing linear. That ref panel is
the clearest example of the tier line being about *shape* rather than ownership — it looks like a
first-party privilege and is a plain rectangle a frame can host. It is also the example that got
smaller twice: first the direct `LinearIssuePanel` import became a registry lookup, then the lookup
became `openRefPanel({ providerId, displayId })` and github stopped rendering the panel at all. The
remaining github→linear coupling is one string, in one place, for a reason that is genuinely github's:
`linkifyLinearIds` scans PR body HTML for Linear's key prefixes, so those bare-id anchors are github's
own and carry no URL for a recogniser to claim.

Worth reading: **changes**, for what happens when the one contribution keeping a plugin first-party
stops needing to. Its tool card was a private renderer registry only a compiled plugin could reach;
opening `agents:tool-card` turned it into a manifest line, and the plugin stayed compiled because
that suits it rather than because it has to.
