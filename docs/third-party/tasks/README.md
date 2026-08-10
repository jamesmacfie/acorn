# Task queue — third-party plugin work a developer can pick up

Each file here is one self-contained piece of work: the context it needs, the files it touches, and
what done looks like.

| # | Task | Size | Unblocks |
| --- | --- | --- | --- |
| [07](./07-live-verification-pass.md) | Manual verification pass over the linear migration surfaces | M | release confidence |

## Done, and where the durable part of each now lives

Tasks 01–06 have landed and their briefs are retired; a task file is scaffolding for doing the work,
not a record of it. What each left behind:

- **01, host scanner over declared content links.** `scanContentRefs` in
  `client-core/registries/contentLinks.ts`. It extracts `https://` candidates and runs each through the
  existing `parseInAppTarget` rather than compiling the declared patterns into a second matcher —
  a `ContentLinkContribution` carries a `parse` function, so first-party recognisers have no pattern to
  compile and would have been invisible to one. `plugins/linear/src/contract/` is gone entirely.
- **02, `refResolvers`.** Documented in [docs/plugins.md](../../plugins.md) beside `agentContexts`, whose
  shape it copies; the response schema and the argument for keeping its vocabulary tiny are in
  `@acorn/protocol/refResolvers.ts`. github no longer depends on `@acorn/plugin-linear`.
- **03, bare-ref linkification.** `learnRefPrefixes` / `splitRefTokens` / `linkifyRefs`, beside the
  scanner. The declared token grammar (the design's v2) is still explicitly out of scope: nothing needs
  cold-start bare refs, and it must not ship before candidates can be confirmed through a resolver.
- **04, the two dead-click gates.** `openPluginContentTarget` consults `paneAvailable` via a new
  task-by-id accessor (`client-core/tasks/taskLookup.ts`, installed by the composition root), and
  `RefPanelContribution` carries the same per-node `when` the pane surfaces do.
- **05, authored source empty states.** `emptyState` on `PluginSourceDescriptor`, rendered by
  `ChromeSourcePanel`. Linear's own-issues fallback is withdrawn — the decision, and the one gap it
  leaves (no context-free verb can reach the settings modal), are recorded in [linear.md](../linear.md)
  § finding 1.
- **06, dev builds no longer pin.** `build:plugin` marks what it writes into the data root, and
  reconciliation treats a marked package as app-owned. See [docs/plugins.md](../../plugins.md) §
  distribution.

The three remaining plugin migrations are their own briefs, one level up: [http.md](../http.md),
[database.md](../database.md), [editor.md](../editor.md). Read [../README.md](../README.md) first
for the tier's mechanics and the review history behind these tasks, and
[../cross-plugin-refs.md](../cross-plugin-refs.md) for the design tasks 01–03 implemented.
