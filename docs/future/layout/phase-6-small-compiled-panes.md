# Phase 6: the small compiled panes

Status: not started.

## Goal

Move the small first-party panes to layouts and kit trees on the direct render path: context (tray
as slots), memory (a tree in its slot), notes (finish from phase 1), changes, docker, the terminal
drawer chrome, workflows settings, and the onboarding wizard. Memory and changes drop off the
first-party-only list at the end of this phase.

## Why this phase, and why now

These panes are small and regular and exercise every layout except `tabs`-as-pane (github) and the
full `header-body-footer` transcript (agents). Doing them before the two large panes means every
layout and every slot pattern has been used by first-party code before the largest pane depends on
it.

## Scope

In: the plugins below, rewritten against the kit with no raw `div` or `span` and no plugin CSS.
Behaviour is unchanged; visual differences are listed per pane and accepted.

Out: agents, github (phases 7 and 8); the terminal's xterm itself (a rectangle); docker's footer
badge and terminal's drawer chrome beyond the layout (descriptors and slots already).

## Per pane

### context

Layout `header-body-footer`. Header: `Heading` and the sync `Alert`. Body: a `Fold` per section with
a `Meter` in `meta`, containing a `Slot point="section" key={section.id}` whose default children are
the section's `Row`s with `checked` and origin `Badge`s. Footer: the `CodeBlock` preview in a `Fold`
and the sync `Toolbar` with its `Picker`. The `contextSectionSlots` registry is replaced by the
`context:section` slot; `persistedStateSlices` for the pane's selection stays.

Accepted differences: section rows gain the kit's row height; the preview is folded by default.

Files: `plugins/context/src/client/ContextPane.tsx`.

### memory

Its section becomes a tree registered against `context:section` for key `memory` on the direct path:
`Stack` of `Card`s, each with `Field`, `Input`, `Select`, `Textarea`, and a `Toolbar` of Accept and
Reject `Button`s. Raw `<input class="ui-input">` disappears.

Files: `plugins/memory/src/client/MemorySection.tsx`, `plugins/memory/src/client/index.ts`.

### notes

Finish phase 1's proof: the toolbar as a `Toolbar` node in `list-header`, the edit toggle as a
`Toggle`, the body as `Markdown` or `Textarea`.

### changes

Layout `list-detail`. List: `Section`s for staged and unstaged with `Row`s carrying `badge` for
status and `actions` for stage, unstage, discard (`ConfirmButton`). `list-footer`: the commit
`Input` and Commit and Push `Button`s. Detail: `DiffPane` with `annotations` from the plugin's own
review notes through the `changes:diff-line` point, which makes review notes the first annotation
consumer. Before push and before commit call `ctx.hooks.run` (wired in phase 4).

Accepted differences: review notes draw in the annotation style rather than the custom row.

Files: `plugins/changes/src/client/ChangesPane.tsx`.

### docker

Task pane: layout `header-body`; header is a `ChipRow` of containers; body is `ContainerDetail` as a
`Tabs` node with Info (`Facts`), Logs (`Log` with find), Stats (`Meter`s and a `Slot
point="stats-beside" mode="stack"`), Exec (`Rectangle kind="pty"`). Browse (the rail source): a
`Section`ed `TreeRow` list with a filter `Toolbar`. The `docker:container` annotation draw site on
browse rows lands here.

Files: `plugins/docker/src/client/{DockerTaskPane.tsx,ContainerDetail.tsx,DockerBrowse.tsx,
DockerExecTerminal.tsx}`.

### terminal

The drawer is layout `stack-split`: top is a `Tabs` node of sessions with a `Menu` for profiles;
bottom is `Rectangle kind="pty"` wrapping `TerminalSurface`. Settings is `Field`s over `Select` and
`Checkbox`.

Files: `plugins/terminal/src/client/{TerminalPanel.tsx,TerminalSettings.tsx,drawerContribution.tsx}`.

### workflows

Settings: `Field`s and `Alert`s in a `Stack`.

Files: `plugins/workflows/src/client/WorkflowsSettings.tsx`.

### onboarding

Layout `wizard` in the overlay slot: steps from the existing step list; bodies as `Card`, `Field`,
`Badge`, `Facts`. The custom backdrop and dot strip go.

Files: `plugins/onboarding/src/client/{OnboardingWizard.tsx,OnboardingOverlay.tsx,GithubConnect.tsx}`.

## Design detail

- All on the direct path: components register kit trees through `ctx.panes.register({ layout,
  regions })`.
- Slots on the direct path: `Slot` resolves first-party contributors by registry and third-party by
  worker; memory registers as a first-party contributor through `ctx.contribute`-style registration
  onto `context:section`, which the host owns, so it is a named `ctx.extensions.register`.
- Plugin CSS deleted per plugin as it moves.

## Code touched

- The files above.
- `packages/client-core/src/registries/*`: `contextSectionSlots` removed; the slot registry is
  `plugins/tree/registry.ts`.
- `plugins/*/src/client/*.css` for these plugins: deleted.

## Tests

- Each pane's existing tests pass against the tree version.
- Memory's section renders inside context's slot in the jsdom tier; disabling memory draws context's
  default rows.
- Review notes appear as `DiffPane` annotations stamped `changes`.
- Docker exec still attaches a PTY; terminal tabs still switch sessions.
- Onboarding's steps still complete the first-run flow (the desktop boot test covers the empty-node
  case).

## Docs owed

- `docs/first-party-plugins.md`: memory and changes move off their tables; docker and onboarding
  lose reason B rows.
- `docs/agent-tools.md` § "Context sections": `contextSectionSlots` is a slot.
- `docs/notes-and-memory.md` § "Context integration": the slot.
- `docs/docker.md` and `docs/terminal-and-agents.md` § "Client": layouts.

## Doors left open

- No plugin CSS remains in these plugins.
- Every pane declares a layout with documented projections; exec and the drawer are `pty`
  rectangles, native in a terminal.

## Done when

- All listed panes render through layouts with no raw `div` or `span` and no CSS file.
- Memory is a tree in a slot; disabling it leaves context working.
- `pnpm lint`, `pnpm test`, and the desktop boot test are green.

## Verify before building

- `plugins/context/src/client/ContextPane.tsx` has the hand-drawn tray rows and `Meter`s the survey
  saw; `plugins/memory/src/client/MemorySection.tsx` uses raw `<input class="ui-input">`.
- `plugins/changes/src/client/ChangesPane.tsx` is a `ListDetail` with a commit `input` and
  `DiffPane`.
- `plugins/docker/src/client/ContainerDetail.tsx` uses `Tabs`, `DescriptionList`, `FindBar`, and
  `Meter`.
- `plugins/terminal/src/client/TerminalPanel.tsx` uses `SplitHandle` and `DocumentTabs`.
- `plugins/onboarding/src/client/OnboardingWizard.tsx` has the custom `wizard-backdrop` and dots.
- The `contextSectionSlots` registry exists in `client-core/src/registries`.
