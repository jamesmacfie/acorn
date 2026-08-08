# Phase 1 — Task-origin behavior registry

**Size: M.** Provider-neutral. After this phase a plugin can register a task origin
(`smolforge:issue`), promote its external items into tasks with that origin, and have the shell
render such tasks correctly — icon, label, reference panel, link-back — without core knowing the
provider.

## The actual gap (narrower than it looks)

`Task.origin` is already a plain `string` on the wire (`packages/protocol/src/api.ts` — task
create takes `origin: Task['origin']`, and the docs' "github-pr | linear | rollbar | local"
wording describes convention, not a type union). So the wire needs nothing. What is hardcoded is
**behavior keyed on origin**: where the client picks an icon/label for a task's origin, where a
task's linked external item is resolved and rendered (reference panels), and where "create task
from item" flows live per provider. Those switch on the four known strings today. The work is a
registry that makes origin behavior a contribution, plus audit-and-replace of the switch sites.

Do this phase after locating every consumer: grep the client for the origin literals
(`'github-pr'`, `'linear'`, `'rollbar'`, `'local'`) and list the sites in the PR description —
the enumerated list is the review artifact, and any site left switching on a literal is a bug
this phase creates.

## Design

### Origin ids

Namespaced: `<pluginId>:<kind>` (`smolforge:issue`, `smolforge:pr`). Core-owned origins keep
their historic un-namespaced ids (`github-pr`, `linear`, `rollbar`, `local`) — they are persisted
in task rows and layout state; renaming them is a data migration with zero payoff. The host
validates that a plugin registers only origins under its own namespace (same anti-squat rule as
routes and providers).

### Client: origin contribution

New registry in `packages/client-core/src/registries/` (copy the shape of an existing simple
registry, e.g. `nodeStats.ts`), exposed on `ClientPluginContext`:

```ts
type TaskOriginContribution = {
  id: string                           // 'smolforge:issue'
  label: string                        // 'Forge issue'
  icon: string                         // Lucide name string (resolved like glyph/tasks.icon)
  // Where "open the linked item" goes: a ref panel id or a pane id owned by the same plugin.
  refPanel?: string
}
```

Unknown origins (plugin disabled, or a task created by a newer version) must render degraded,
not break: fall back to the `local` treatment with the raw origin string as tooltip. Add that
fallback at the registry lookup, and a test for it — tasks outlive plugins.

### Node: promotion

Task creation already accepts arbitrary `origin` and an external-item linkage
(`packages/node-core/src/server/routes/tasks.ts`; external items via
`server/integrations/itemStore.ts`). Verify and, where missing, add:

- creating a task with `origin: '<pluginId>:<kind>'` + an `ExternalRef` records the linkage the
  same way `github-pr` tasks record theirs;
- the origin namespace is validated against the calling plugin when creation goes through a
  plugin route, and unrestricted for core routes (the client's own create flow may promote any
  connected provider's item);
- task reads serialize enough for the client registry to render (origin + external ref).

Branch naming: promoted tasks flow through the existing branch-prefix/normalization path
(repo-level settings) — provider plugins must not invent their own branch-name logic.

### Descriptor verb: `createTask`

The declarative-chrome action vocabulary (docs/third-party/phase-4-declarative-chrome.md:
`openPane`, `invoke`, `runNodeAction`, `openUrl`) gains one host-executed verb:

```jsonc
"onSelect": { "createTask": { "origin": "smolforge:issue" } }
```

Semantics: the host takes the selected row's item ref (source rows gain an optional
`externalRef` field), resolves the project via the row's node + the provider's remote claim
(phase 0), and drives the same task-creation flow the GitHub promotion uses — worktree first,
then the task wrapping it, per the existing ordering. Validated at manifest parse: the named
origin must belong to the declaring plugin. First-party plugins get the equivalent through the
sources registry's typed promotion (`SourceContribution`'s promotion generic — see
`registries/plugin.ts`'s `sources.register<Item>` note), which already exists; the verb is the
descriptor-tier projection of it.

## Steps

1. Audit: enumerate every client site switching on origin literals; every node site assuming the
   four origins.
2. Client `taskOrigins` registry + fallback rendering; migrate the audited sites to registry
   lookups; register the four built-in origins from their owning plugins (github, linear,
   rollbar) and core (`local`).
3. Node-side namespace validation on plugin-route task creation.
4. `createTask` verb in the descriptor action executor + manifest validation (lands with or
   after docs/third-party phase 4; if that phase hasn't shipped, implement the verb behind the
   sources promotion path so first-party works now and descriptors pick it up later).
5. Tests: unknown-origin fallback; namespace enforcement; promotion linkage round-trip (create
   from item → task carries origin + ref → ref panel resolves); the four built-ins render
   identically to before (snapshot the audited sites' behavior first).

## Exit criteria

- A test plugin registers `test:thing`, promotes a fake external item to a task, and the task
  renders with the plugin's icon/label and resolves its ref panel.
- Disabling that plugin leaves its tasks rendering via the fallback, not crashing.
- No client or node site switches on origin string literals outside the registries.
- `pnpm lint`, suites, boundaries test green.
