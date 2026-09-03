# Command palette: one graph, one session, every contributor

A programme, 2026-09-03. Nothing here is scheduled and nothing in it has started. It was written
against commit `7d62e3ec`, which is the baseline every path and current-state claim in this folder
refers to. Where this folder disagrees with
[command-palette-and-shortcuts.md](../../command-palette-and-shortcuts.md),
[plugins.md](../../plugins.md), or [tui.md](../../tui.md), those owning documents win until a phase
ships and moves its behaviour there.

## The decision

Acorn will have one command graph and one host-neutral palette session. Core, compiled plugins, and
loaded plugins contribute commands to that graph. An entry is an action, a group, a dynamic search,
a submitted text input, or an opt-in setting. Desktop and terminal clients draw the session in their
own host, but query, hierarchy, selection, cancellation, invocation, and error semantics live once
in client-core.

Plugins never draw inside the command palette. A compiled plugin supplies typed callbacks. A loaded
plugin supplies bounded descriptors and plugin-owned routes; the host validates the returned facts
and executes a closed, manifest-declared action. Search results cannot smuggle executable actions in
their response.

## Product rules

1. The palette remains one surface on the one shared keymap. A new command kind is not a new overlay
   or another global key listener.
2. Empty root search shows top-level commands. Typing at the root searches all descendants by their
   full breadcrumb, so hierarchy reduces noise without making a command undiscoverable.
3. Enter pushes an interactive command or invokes a leaf. Escape pops one frame and restores its
   query and selection; at the root it closes and restores focus.
4. Remote search is debounced and cancellable. Submitted input is never debounced: the user presses
   Enter once, sees a loading state, and cannot submit twice.
5. Scope belongs to a command. `node` is the default; `task`, `project`, `workspace`, and `fleet` are
   explicit. Nothing silently fans out across the fleet.
6. A result has one primary action in this programme. Destructive and multi-action operations stay
   in their owning panes and existing confirmation flows.
7. A setting appears only when its owner deliberately registers a setting command. The palette does
   not reflect arbitrary settings-page UI, and the command and page use the same persistence
   accessor.

## What this replaces

Today `CommandContribution` is a flat runnable row. `CommandPalette.tsx` and the TUI `Palette.tsx`
separately fetch plugin rows, compose tasks and workspaces, filter them, track their owner, and invoke
them. `PaletteRowSource` can fetch live rows, but only compiled client plugins can provide its
callbacks. Loaded plugin manifests can register only static commands. The editor and GitHub each
build another command-palette-shaped overlay for a local file finder.

The programme replaces those separate orchestration paths with the graph and session in
[architecture.md](./architecture.md). It does not replace the generic overlay helper where a picker
is not a command surface.

## The files

- [review.md](./review.md) is the evidence: the current data flow, the two plugin tiers, the duplicate
  host logic, the first-party inventory, and the useful parts of Raycast.
- [architecture.md](./architecture.md) is the target contract and the state machine.
- [command-catalog.md](./command-catalog.md) records what each core or plugin surface should expose,
  defer, or refuse.
- [phases.md](./phases.md) is the dependency graph and status table.
- Seven phase files are self-contained handoffs. Each names prerequisites, boundaries, migration,
  tests, exit criteria, rollback, and a verify-before-starting list.
- [refused.md](./refused.md) keeps the rejected designs decided.

## The phases

| Phase | What it establishes | Status |
| --- | --- | --- |
| [0](./phase-0-baseline-and-contract.md) | Characterization tests, command and wire types, graph validation, and backward-compatible manifest parsing. | Shipped 2026-09-03. |
| [1](./phase-1-command-graph-and-session.md) | One command graph and session controller, nested navigation, direct shortcut entry, and desktop/TUI renderers. | Shipped 2026-09-03. |
| [2](./phase-2-search-and-input.md) | Debounced search, explicit input submission, cancellation, scope and fleet fan-out, plus loaded-plugin route adapters. | Shipped 2026-09-03. |
| [3](./phase-3-settings-and-core-commands.md) | Setting commands, core hierarchy, navigation searches, and the first shared preference accessors. | Next. |
| [4](./phase-4-compiled-plugin-adoption.md) | The compiled plugins adopt the graph; terminal/workflow rows and specialist file finders leave their private paths. | Waits on phases 2 and 3. |
| [5](./phase-5-loaded-plugin-adoption.md) | Database, HTTP, Linear, and Rollbar prove the declarative search/input contract. | Ready; may run beside phase 4. |
| [6](./phase-6-cutover-and-documentation.md) | Compatibility code is removed only after zero-use checks, owning docs take the behaviour, and this folder retires. | Waits on phases 3–5. |

## Done when

- Desktop and TUI render the same session transitions from shared fixtures.
- Every existing static command and shortcut still works, including loaded manifests that omit
  `kind` and the legacy manifest `palette` alias.
- Rollbar issue search issues one debounced request, ignores stale replies, and navigates to the
  selected item.
- Database SQL generation shows pending state, writes the result to the task scratch document, and
  opens the Database pane; failures preserve the prompt.
- Theme and notification setting commands show the current value and write through the same helpers
  as Settings.
- Terminal targets and workflows retain their current launch behaviour with no `paletteRows`
  registrations left.
- The editor's Command-P and the GitHub changed-file finder open the unified session at their
  interactive command.
- `pnpm lint`, `pnpm --filter @acorn/tui test`, `pnpm --filter @acorn/desktop test`, and `pnpm test`
  pass.
- Shipped behaviour lives in the owning documents, this folder is removed, and the retirement is
  recorded in [the future index](../README.md).

## How this relates

[client-plugins](../client-plugins/README.md) can change who contributes a command but must not create
a second palette. [terminal-rewrite](../terminal-rewrite/README.md) may change how the TUI draws the
session, but its command state remains in client-core. Loaded-plugin containment and route ownership
remain governed by [security.md](../../security.md); this programme adds no executable result
payload and no plugin-rendered rectangle.

