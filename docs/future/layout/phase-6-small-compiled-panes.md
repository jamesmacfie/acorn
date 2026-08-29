# Phase 6: the small compiled panes

Status: shipped 2026-08-30.

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
- `packages/client-core/src/registries/*`: `contextSectionSlots` deleted; the slot registry moves
  to the new `packages/client-core/src/plugins/tree/` as `registry.ts`.
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

## What shipped, and where it differs

Nine deviations from the plan above. Each was a decision made while building, and each is recorded
here rather than in the owning doc, because the owning doc says what is true and this says what
changed.

**1. The compiled tier gained a fifth carrier.** The plan said memory "registers as a first-party
contributor through `ctx.contribute`-style registration onto `context:section`, which the host owns,
so it is a named `ctx.extensions.register`". That named point exists, and so does `ctx.extensionPoints`
beside it, both stamping what the manifest path stamps. What the plan did not say is what a compiled
contribution carries: `ExtensionContribution.carrier` gained `'component'`, and `carrierFits` accepts
it wherever a `remote` bundle is accepted. Which one answered is invisible to the owner. This is the
first-decision-in-the-README made real, and it means the two render paths meet at `Slot` rather than
at a second registry.

**2. `Slot` was drawing a `stack` point as though it were `replace`.** It rendered the owner's default
children only when nobody matched, in either mode.
[03-extension-kinds.md](./03-extension-kinds.md) says a `stack` point is "the owner's default plus
every match", so a stacked contributor was silently hiding its host's own content. Fixed in `Slot.tsx`,
which is the only place the difference is visible: `resolveSlot` answers who draws, not what else is on
screen. Without the fix, enabling memory would have deleted context's own item rows.

**3. Review notes are not annotation contributions.** The plan said the detail region draws
"`DiffPane` with `annotations` from the plugin's own review notes through the `changes:diff-line`
point, which makes review notes the first annotation consumer". Half of that shipped: `changes:diff-line`
is declared and `DiffPane` is given it, so any plugin can mark a line. The review notes themselves
stayed on `DiffSource.lineExtra`, because an annotation mark carries a severity, a line of text and an
icon and has no verb, and a review note needs Delete and a sent-or-unsent state. Converting them would
have cost behaviour the phase promised not to change. They are drawn with kit nodes in the same shape
a mark is, which is the visual half of what the plan asked for.

**4. `Rectangle` and `ConfirmButton` joined the kit.** Both are in the frozen node set in
[04-kit.md](./04-kit.md) and neither existed. `Rectangle` is what a PTY sits in, and this phase
produced its first two consumers: Docker's exec tab and the terminal drawer. Adding it forced two
table rows, a focus role, and a place on the wire vocabulary, because `protocol.test.ts` holds the wire
and the kit to the same list. `ConfirmButton` was already implemented and simply was not exported.

**5. `Row` kept `leading` and `trailing`.** The plan asked for `badge` and `actions`, which are the
names in [04-kit.md](./04-kit.md)'s prop table. `Row` has taken `leading`, `trailing` and `meta` since
phase 0 and every list in the app is written against them. Renaming them is a kit change with a
30-site blast radius and no consumer asking for it, so the changes list passes a `Badge` as `leading`
and its git actions as `trailing`. The rename belongs to phase 9 if anyone still wants it.

**6. `Textarea` gained `grow`, and `.layout-hbf-body` gained a scroller.** Two small host additions
the moves needed. `grow` is the "this region IS a text field" case, which the note editor had been
getting from 12 lines of its own CSS. The `header-body-footer` body was `overflow: hidden`, which is
right for a region that scrolls itself and wrong for the plain run of content context and Docker put
there; it now mirrors `single`'s body, scroller and `padding-inline` both.

**7. `lineExtra` got a host-owned wrapper.** `.diff-row` is `flex-wrap: wrap`, so anything drawn beside
`DiffLine` needs a full basis or it shares the line with the code and squeezes it. Review notes had
that rule in the plugin's stylesheet; the annotation marks phase 4 added did not, and would have drawn
beside the code. `DiffCanvas` now wraps both in `.diff-line-extra`, so neither the owner nor a
contributor has to know.

**8. Onboarding imports `Wizard`.** It is a component in the `overlay` slot, not a pane, so there is no
contribution to name a layout on. `Wizard` is exported from `@acorn/plugin-api/ui/host` alongside
`Slot`, and that entrypoint is the right home: a layout is host machinery, and nothing else on it is
importable by a loaded plugin either. The custom backdrop is a `Modal` with `dismissOn={[]}`, which
keeps the rule that Escape must not skip setup.

**9. `docs/first-party-plugins.md` kept its table rows.** The plan said "memory and changes move off
their tables; docker and onboarding lose reason B rows". None of the four rows was actually earned by
what this phase changed. memory is first-party because it is `required` and publishes two capabilities;
changes' reason B is its agent-tool renderer, which is phase 8's; docker's is its footer badge, which
this phase's scope excludes; onboarding's is that it draws before any plugin is trusted. What did move
is the argument: § reason B named memory's section as the proof that a cooperative point cannot carry a
real interface, and that paragraph is rewritten, because it can and now does.

## Owed after this phase

- The API major moved from 5 to 6. Removing `contextSectionSlots` from `@acorn/plugin-api/client`
  shrinks the surface, and the snapshot gate refuses that under an unchanged number. Every loaded
  package is stamped from `PLUGIN_API_MAJOR` at build, so a rebuild is the whole migration.
- The terminal drawer keeps `terminal.css`, trimmed to its outer box. § Scope excluded "terminal's
  drawer chrome beyond the layout", and the drawer is a slot rather than a pane, so no host layout
  owns where it sits.
- `docs/first-party-plugins.md`'s tables, per deviation 9, wait on phases 7 and 8.
