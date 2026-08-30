# Phase 1: core stops naming plugins

Status: **shipped 2026-08-31**. Five things landed differently from the plan below; they are recorded
in "What shipped differently" at the end, and the owning docs already say the true version. Phase 3
reads that section, not this plan.

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

## What shipped differently

**The diff-view preference was renamed, not moved.** The plan said `github.diff-view` becomes one of
github's `persistedStateSlices`. `DiffPane` turned out to be core's own shared component — `changes`
draws it, github draws it, and so do the tree and remote surfaces — so the preference is core's and
only the slice id was wrong. It is `core.diff-view` now, in the same place, with the stored key
`diff_view` untouched. Moving it into github would have taken the split/unified toggle away from the
`changes` pane whenever github was switched off.

**A source needed two new fields, not one.** `SourceContribution.defaultPane` already existed and was
read by nothing, so the first-pane item only had to give it a reader (`defaultPaneForTask`, asking
whoever owns the task's URL first and a link's provider second). The origin item needed a second
field: a source's rail id and the origin it stamps on a task need not match, and github's do not
(`github` and `github-pr`), so `origins` maps origin id to glyph. Linear declares `defaultPane`
through its manifest, which meant the descriptor schema, the node's parse-time check and the client's
re-check all gained it, the same three places a content link's `openPane` lives in.

**`task.terminal.new-codex` moved too.** The plan named only `new-claude`. Leaving its sibling behind
would have split one decision across two packages for no reason: both name a profile id the agents
plugin declares. Both are in `plugins/agents/src/client/terminalProfileCommands.ts` now, registered
app-wide with a `when: () => !!activeTaskId()` rather than per task. The shell keeps
`task.terminal.toggle` and `task.terminal.new-shell`, which are the drawer's and a plain shell's.

**Moving the context sections cost a plugin API major.** `memorySection`, `notesSection` and
`pullRequestSection` were exported from `@acorn/plugin-api/node`, and shrinking that surface is a
`PLUGIN_API_MAJOR` bump by this repo's own rule. It went to `8`, the loaded packages were rebuilt, and
`docs/plugins.md` § The plugin API records the reason. The plan did not anticipate the cost; it is
paid.

**The arch rule is an allowlist with reasons, not a baseline at zero.** The plan wanted the baseline
empty. Ten roster ids are also core's own words — `terminal` is a UI style, a command category, a
setup-script trigger and an agent controller; `context` is an agent input part; `github` is an install
source kind and a brand mark — and a string match cannot tell them apart. Emptying that list would
mean renaming core vocabulary, which is worse than the thing the rule is for. So `core never names a
plugin` in `tools/arch/boundaries.test.ts` carries a `NAMES_A_PLUGIN_OK` map of file to reason,
entries may only be removed, and no exception may outlive the code it excuses. Nine roster ids —
`agents`, `browser`, `docker`, `linear`, `model-providers`, `nodes-file`, `onboarding`, `preview`,
`rollbar` — are held at zero, which is the tracker case the phase was written for. Tests are exempt:
a fixture naming a plugin is a fixture, the same reasoning the schema and testkit ratchets use.
