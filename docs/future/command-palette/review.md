# Command palette review: the flat list has reached its boundary

Reviewed 2026-09-03 against `7d62e3ec`. This is evidence for a future design, not shipped behaviour.
Paths are orientation hints; re-read the owning documents and live code before implementation.

## Executive finding

The current palette successfully centralizes static command discovery and shares its keymap, but its
data model is still a flat list assembled by each host. The first two dynamic contributors—terminal
run targets and workflows—sit beside commands through a second registry. Loaded plugins cannot use
that registry at all. Settings pages expose components rather than addressable values. The next
features therefore do not need another row kind; they need one command graph and a session state
machine.

## Current data flow

### Static commands

1. Core and compiled plugins call `ctx.commands.register` or `registerCommands`.
2. Loaded manifests declare `contributions.commands`; `chromeRegister.ts` qualifies the ID, checks
   node availability, and wraps the declared action in `runChromeAction`.
3. The command registry holds `{ id, title, hint, category, palette, requires, when, run }`.
4. Each host reads the registry, filters on `palette` and availability, and converts a command into a
   flat palette action.
5. `executeCommand` looks the command up again and calls `run()` with no execution context.

This is a sound path for a leaf action. It has no representation for a parent, interactive query,
loading state, current setting value, or action outcome.

### Dynamic rows

`PaletteRowSource` is a parallel contribution vocabulary with `rows(taskId)` and
`invoke(item, taskId)`. The desktop and TUI palettes fetch every eligible source when the palette
opens, convert failures to rows, build an item-to-source map, and hand a picked row back to its
owner. The terminal plugin supplies run targets and layout recipes; workflows supplies runnable
definitions.

That seam solved ownership correctly—host code does not switch on a plugin row kind—but it has four
limits:

- it refreshes on open or task change, not on query change;
- it carries only a task ID rather than an explicit execution context;
- it cannot express children, input, setting choices, or cancellation;
- its live callbacks exist only in the compiled client tier, despite the contribution map calling
  palette rows a two-tier concept.

### Host duplication

`packages/client-core/src/host/palette/CommandPalette.tsx` and
`apps/tui/src/chrome/Palette.tsx` both own resource fetch, row composition, ownership, filtering,
selection, and invocation. They share `paletteModel.ts`, but that module supplies only the flat item
union and fuzzy scoring. Any nested or asynchronous behaviour added to one component would have to
be independently reproduced in the other.

The rendering should remain separate: one host draws a dialog and listbox, the other cells in a
terminal. The state transitions should not.

### Specialist palettes

The editor's file picker and GitHub's changed-file picker use `createOverlayPalette`,
`PaletteSurface`, and the shared fuzzy scorer, but each owns another open/query/selection lifecycle.
Their shortcuts already resolve through the central keymap. They are therefore good migration tests:
a shortcut should be able to enter a named interactive command directly without creating a private
overlay controller.

The workspace picker also uses the generic helper. It is a topbar picker rather than evidence that
every overlay must become a command, so the helper cannot be deleted merely because the two file
finders migrate.

## The two plugin tiers

### Compiled plugins

Compiled client plugins may register functions, so a search provider can receive a query, context,
and `AbortSignal`, and a setting command can share an accessor with its Settings component. The host
still owns frame transitions and rendering.

### Loaded plugins

A loaded manifest is data. Its current command descriptor has a static title, category, palette flag,
and context-free closed action. It cannot send a live function to the client and must not be given a
plugin-rendered palette frame as a workaround.

The existing declarative chrome pattern already supplies the answer: a descriptor names a
plugin-owned route and a closed selection action. The host calls the route on the selected node,
validates and bounds its facts, and later executes the action it accepted from the manifest. The
response never chooses code or a verb.

The manifest's JSON Schema is generated from `plugin/contract.ts` by
`packages/plugin-types/src/pluginSchema.test.ts`. The command change must remain additive: a command
without `kind` still parses as the action it means today.

## Settings are pages, not fields

`SettingsContribution` identifies a page component. Appearance writes individual preferences with
`savePref`; Notifications writes one bounded JSON preference; Terminal and Docker have plugin-owned
settings pages using the same persistence helpers. Loaded settings are frame or remote-tree surfaces.
There is no typed field registry for the palette to inspect, and inventing one solely to scrape
components would create a second settings architecture.

The smallest honest seam is an opt-in `setting` command. Its owner provides read/options/write and
uses those same functions from the existing page. Complex settings such as agent pricing,
concurrency, connection secrets, or HTTP variables remain pages.

## First-party capability survey

The repository contains nineteen first-party plugin packages:

- Compiled client surfaces: agents, changes, context, Docker, editor, GitHub, memory, notes,
  onboarding, preview, terminal, and workflows.
- Node-only or non-user surfaces: browser.
- Loaded packages: database, HTTP, Linear, Rollbar, model providers, and nodes-file.

Their approved and refused commands are recorded in [command-catalog.md](./command-catalog.md). The
important asymmetry is not how many operations a plugin owns; it is whether an operation has an
honest, context-complete palette representation. Browser capture tools, connection secrets, row
editing, merge, prune, and workflow kill do not become good palette commands just because they exist.

## What is useful from Raycast

Raycast provides evidence for four interaction mechanics, not a visual design to copy:

1. Navigation is a stack: pushing a child replaces the current view and Escape pops it while
   preserving the parent. See the official
   [Navigation API](https://developers.raycast.com/api-reference/user-interface/navigation).
2. A searchable list can delegate filtering to an async source, throttle query changes, and state
   loading and empty results explicitly. See the official
   [List API](https://developers.raycast.com/api-reference/user-interface/list).
3. Actions belong to the command or selected result context rather than to arbitrary response data.
   See the official
   [Action Panel API](https://developers.raycast.com/api-reference/user-interface/action-panel).
4. Native host components make keyboard, focus, and loading behaviour consistent across extensions.
   Acorn's equivalent is its closed kit and host-owned palette surface.

This programme deliberately stops before result action panels. One primary action proves the graph,
route, and invocation contracts without normalizing destructive operations into a low-context menu.

## Consequences

- The command registry becomes the vocabulary; `paletteRows` becomes a compatibility adapter and
  then disappears.
- The session is a client-core domain object, not Solid state embedded in either host renderer.
- A loaded plugin's query is an ordinary authenticated plugin route with explicit scope and normal
  error envelopes.
- Root discovery needs breadcrumb-aware indexing so nested commands remain searchable.
- Keybinding dispatch must distinguish leaf actions from interactive commands and open the latter at
  the right frame.
- Async chrome actions must report completion to the palette instead of always becoming fire-and-forget.

## Risks to carry into implementation

- A graph can contain cycles, orphans, duplicate IDs, or an unavailable ancestor; validation must
  make those impossible or inert.
- A slow search response can overwrite a new query unless both cancellation and generation checks
  exist.
- Fleet fan-out can multiply provider traffic and error noise; it must be opt-in.
- Closing before an async action resolves loses the only useful error surface; invocation needs an
  outcome contract.
- A command that persists a setting through a new code path can drift from Settings; shared accessors
  are an acceptance condition, not a cleanup suggestion.
- Database generation currently also offers provider/model/example selection. The palette's single
  input is a fast path with the existing default-selection rule, not a replacement for the full modal.

## Verify before building

- Re-read the current command, palette-row, settings, and manifest descriptor types.
- Search for every `createOverlayPalette`, `PaletteSurface`, and `paletteRows.register` call; do not
  assume the census above is still complete.
- Re-check which first-party plugins are compiled by both hosts and which ship as loaded bundles.
- Run the existing command registry, chrome registration, palette model, overlay, desktop plugin
  disable, and TUI key suites before changing their contracts.
- Confirm no later programme has already introduced a shared palette session or changed plugin API
  compatibility.

