# Phase 1: core stops naming plugins

Status: not started. Waits on phase 0.

## Goal

No file under `packages/*` names a plugin. Every place that did either reads a contribution the plugin
declares or has moved into the plugin. An arch rule holds the count at zero, so the next tracker,
harness, or terminal-shaped plugin is one roster line and no core edit, which is the claim
`docs/plugins.md` § Adding a plugin contribution already makes.

## Why this phase, and why now

`docs/architecture-overview.md` § Product model still says task origins are `github-pr`, `linear`,
`rollbar`, or `local`. In the code that is a comment on a text column and one built-in row, so the
enum is already gone in all but name. The remaining literals are each small and each has a seam
beside it that was built for exactly this. Doing them together is what lets the arch rule land with a
baseline of zero rather than a list that has to be argued down later. It waits on phase 0 only so
the rule's package list is final.

## Scope

Every item names the seam that already exists. None adds a registry.

### Task origin

`packages/client-core/src/features/tasks/origin.ts` keeps `github-pr` as a built-in glyph row. The
function already falls through to `sourceRegistry.get(origin)`, so the row goes and github's source
contribution supplies the glyph. `local` stays: it is core's own origin. The comment on `origin` in
`packages/node-core/src/server/db/schema.ts` becomes "a plugin-declared source id, or `local`".
`docs/architecture-overview.md` § Product model and `docs/workspaces-and-tasks.md` say the same.

### First pane

`packages/client-core/src/features/tasks/activate.ts` picks the first pane with
`t.links.some((l) => l.providerId === 'linear')` and lands on `'linear'` or `'pr'`. The choice becomes
data on the source that tracks the task: `SourceContribution` in
`packages/client-core/src/host/registries/sources/sources.ts` gains an optional `defaultPane`, github
and linear declare theirs, and `activate.ts` asks `taskTracksRef`'s owner. A task no source claims
falls to the layout reducer's default, which is what happens today when the persisted layout is empty.

### The terminal probes

`features/tabs/TabRail.tsx`, `features/tasks/agentSessions.ts`, `apps/desktop/src/client/TaskView.tsx`,
and `apps/desktop/src/client/App.tsx` ask `hasHostCapability({ plugin: 'terminal' })`. The probe is a
host question and stays (see [refused.md](./refused.md)). The decision that uses it, "a new agent
session needs the terminal plugin", belongs to `plugins/agents`, which already depends on terminal.
The desktop's `task.terminal.new-claude` command moves to agents' command contributions. What core
keeps is the capability query; what moves is the sentence that names the plugin. The `apps/desktop`
sites are a composition root and could keep the literal by the rule below, but the command is agents'
and moving it costs one file.

### The diff-view preference

`packages/client-core/src/infra/persistence/preferenceSlices.ts` declares `github.diff-view` as a core
slice. It becomes one of github's `persistedStateSlices`, beside `prFiltersSlice` in
`plugins/github/src/client/index.ts`. The persisted key does not change, so nothing migrates.

### Context sections

`packages/node-core/src/server/agentTools/contextSections.ts` builds the `pr`, `notes`, `memory`, and
`issues` sections and names `jump: { pane: 'notes' }`. Each builder moves to its owning plugin
(github, notes, memory, and the tracker that owns issues) through `ctx.contextSections`, which is
compiled-only and fine here because all four owners are compiled. Core keeps the assembly, the
512 KiB ceiling, and the order.

### MCP registration

`packages/node-core/src/server/mcpRegister.ts` declares `AgentFlavour = 'claude' | 'codex'` and knows
each CLI's `mcp add` and `mcp remove` argv. The harness declaration in `plugins/agents` carries its
own register and remove commands, and core runs what the harness declared. `registerAcornMcp` keeps
its signature for the terminal plugin, which calls it; the flavour becomes the harness id.

### The arch rule

`tools/arch/boundaries.test.ts` gains: no source file under `packages/*` contains a string literal
equal to a plugin id from the `plugins/` roster, comments excluded. Exemptions by construction:
`apps/*` (composition roots), the `install source kind` `'github'` in the installer and its settings
page (it names a website, not the plugin; the test allowlists those files with that sentence), and
`packages/plugin-api` (a facade that names plugins in its re-export paths). Start the baseline at
whatever survives the items above, with the intent that it is empty. Anti-vacuity: the rule must
have found at least one literal on a scratch file to be trusted.

## Out of scope

- Removing `hasHostCapability({ plugin })`. It is the host's own question.
- The composition roots' plugin names. `apps/node/src/composition/composition.ts` importing
  `GITHUB_MIRROR` is what a composition root is for.
- The install-source kind `'github'`. Different thing, same word.
- Protocol's plugin-named modules (`browserRules`, `managedAgents`, `terminal`, `notes`, `workflow`).
  Already a shrinking list with its own rule.

## Done when

- The baseline in the new rule is empty.
- A scratch `const x = 'linear'` in `packages/client-core/src/features/tasks/activate.ts` fails
  `tools/arch`.
- Disabling the github plugin leaves a `github-pr` task drawn with the fallback glyph and its origin as
  tooltip, which is the behaviour `origin.test.ts` already pins for unknown origins.
- `docs/architecture-overview.md` § Product model no longer lists origins.

## Verify before building

- `origin.ts` still has the `github-pr` row and still falls through to `sourceRegistry`.
- `SourceContribution` has no `defaultPane` or equivalent yet.
- `contextSections.ts` still builds the four sections inline.
- `mcpRegister.ts` still declares `AgentFlavour` as a two-member union.
- `plugins/github/src/client/index.ts` still registers exactly one persisted slice.
