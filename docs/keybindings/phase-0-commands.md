# Phase 0 — Plugin commands

**Size: M.** The prerequisite: a keybinding runs a command, and loaded plugins have no way to own
one. This phase gives them one, and unifies it with the palette rows they already have.

## What is wrong

`CommandContribution` is a closure:

```ts
export type CommandContribution = {
  id: string
  title: string | (() => string)
  category: CommandCategory
  hint?: string | (() => string | undefined)
  palette?: boolean
  requires?: ClientCapabilityRequirement
  when?: () => boolean
  run: () => void | Promise<void>
}
```

`run`, `title`, `hint` and `when` are all functions. A loaded plugin cannot supply any of them, so
it cannot register a command, so there is nothing for a keybinding to point at.

Meanwhile plugins *do* already have palette rows, through a separate path: a manifest
`palette: [{ id, title, action }]` descriptor, registered as a `kind: 'plugin'` palette row that
routes back to its contributing source
(`packages/node-core/src/main/pluginManifest.ts`, `packages/client-core/src/plugins/chrome/`).
That is a command in everything but name — a title and an action the host executes — and it is the
thing to build on rather than a second mechanism beside it.

## Design

**Plugin commands are palette descriptors, promoted.** One manifest entry produces one command in
the registry; whether it also shows in the palette becomes a field rather than a separate concept.

```jsonc
"contributions": {
  "commands": [{
    "id": "search",                       // host prefixes: "plugin.editor.search"
    "title": "Editor: find in files",
    "category": "action",                 // existing CommandCategory
    "palette": true,                      // default true; false = keybinding-only
    "action": { "verb": "openPane", "pane": "editor" }
  }]
}
```

`action` is the existing closed `chromeAction` union — `openPane`, `runNodeAction`, `openUrl` —
which is what makes this cheap: the executor already exists
(`packages/client-core/src/plugins/chrome/actions.ts`) and the manifest validation for those verbs
already exists.

### Registration

A host adapter walks accepted manifests and registers a real `CommandContribution` whose `run`
closes over the descriptor's action:

```ts
commandRegistry.register({
  id: qualifiedId(pluginId, descriptor.id),      // host-bound, see below
  title: descriptor.title,                        // a string, not a function
  category: descriptor.category ?? 'action',
  palette: descriptor.palette ?? true,
  when: () => pluginEnabledOnActiveNode(pluginId),
  run: () => runChromeAction(descriptor.action, { pluginId, nodeId }),
})
```

Four things that fall out and matter:

- **`id` is host-bound**: `plugin.<pluginId>.<descriptorId>`. A plugin cannot register
  `palette.open`, and the prefix is what phase 1's precedence rule keys on. Same anti-squat rule as
  route namespaces and contribution ids.
- **`when` is the host's, not the plugin's.** A command whose plugin is disabled, or whose node is
  not the active one, must not appear in the palette or fire from a chord. The plugin does not get
  to supply a predicate — it would be a function anyway.
- **`title` is a plain string.** No dynamic titles for plugin commands in v1. Dynamic titles exist
  for things like "Show 3 more" and are not worth a per-render bridge call.
- **`requires` is not exposed.** Client capability requirements are a first-party concept about
  which desktop features exist; a plugin's availability is the enabled/accepted check above.

### Replacing the palette descriptor

`palette` in the manifest becomes an alias for `commands` with `palette: true`, and the existing
palette host pass reads from the command registry instead of its own list. Keep the `palette` key
parsing for one release so an installed manifest does not break, then drop it — it has no external
users yet, which is exactly why now is the time.

This is the part with real cleanup value: after it, "what can a plugin invoke" has one answer
instead of two, and phase 1 binds keys to the same thing the palette shows.

### `invoke`, still absent

The chrome action set deliberately omits `invoke` (an RPC into the plugin's frame), because it
needs a headless frame lifecycle the shell does not have — a manifest naming it fails to parse.
That limit carries here: a plugin command can open a pane, hit one of the plugin's own routes, or
open a URL. It cannot call into its own frame.

For most commands that is enough. Where it is not — an editor's "format document", which only
means anything to the frame that is open — that is **phase 3's** forwarding path, not a widening
of the verb set. Do not add `invoke` here to make phase 3 easier; the two have different
lifecycles and conflating them means a verb that works only sometimes.

## Steps

1. `commands` in the manifest schema: id, title, category (enum, matching `CommandCategory`),
   optional `palette`, required `action`. Reuse `chromeAction` and its cross-field validation
   (an `openPane` must name a pane the same manifest declares; a `runNodeAction` path must be
   inside `/v2/p/<id>/`).
2. `qualifiedId` helper + a boundaries-style test that no plugin command id can collide with a
   first-party one.
3. Host adapter in `packages/client-core/src/plugins/chrome/register.ts`: register commands,
   dispose with the plugin's other contributions.
4. Point the palette pass at the command registry; keep parsing `palette` as an alias.
5. Docs: `docs/plugins.md` manifest reference, `docs/command-palette-and-shortcuts.md` § Palette
   data.

## Tests

- Manifest: a command with each verb parses; an `openPane` naming an undeclared pane fails; a
  `runNodeAction` outside the namespace fails; a command id colliding with a first-party command id
  is impossible after qualification (assert the prefix, not the absence).
- Adapter: registers and disposes with the plugin; a disabled plugin's commands are absent from
  `commandRegistry.entries()` *or* filtered by `when` — pick one and test the one you picked.
- `executeCommand('plugin.x.y')` runs the action; a denied route inside `runNodeAction` surfaces as
  an error toast rather than a silent no-op.
- Palette: a plugin command with `palette: false` does not appear; with `palette: true` it appears
  once, not twice (the alias must not double-register).
- e2e: the chrome fixture's command appears in the palette and runs.

## Exit criteria

- A loaded plugin declares a command, it appears in the palette, and `executeCommand` runs it.
- Plugin command ids are host-prefixed and cannot collide with first-party ones.
- One mechanism: the palette reads the command registry, and the old palette descriptor is an
  alias with a deletion date.
