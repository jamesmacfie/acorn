# Phase 1: docs shape

Status: shipped 2026-08-30. Waited on phase 0.

## Goal

`docs/` has a front door that names every file. The naming conventions are an owning doc. The plugin
documentation says the layout that exists (and the one phases 3 to 5 build toward, marked as such).
Four misnamed files carry the name of what they describe. No two docs hold the same manifest
reference.

## Why this phase, and why now

Phases 2 to 5 rename folders and every one of them has to update owning docs. If the docs are still
six overlapping plugin files with no index, each phase pays for finding them again. Writing
`docs/conventions.md` (new) first also means phases 2 to 5 apply a rule that is written down, rather than
one that lives in this programme's draft.

## Scope

### The front door

Write `docs/README.md` (new). It lists every top-level file under `docs/` grouped by kind (architecture and
contracts, features, plugins, plugin-as-feature, how-to, status) with one line each, then the three
subfolders. Trim `docs/architecture-overview.md` section "Documentation map" to a pointer at it plus
the reading order for a newcomer. Update `CLAUDE.md` and root `README.md` to point at
`docs/README.md` (new).

### Conventions

Move [02-conventions.md](./02-conventions.md) to `docs/conventions.md` (new), reworded from "resolves"
to present tense, and leave the pointer here. Add a line to `CLAUDE.md` naming it.

### The plugin docs

`docs/plugins.md`:

- Split `## Activation` (line 291 to 2415) so each of its 15 h3s becomes an h2. The h3s are already
  distinct contracts: the manifest schema, the dev loop, approval-mediated install, the client half,
  context menus, rail markers, cooperative extension points, hooks, node providers, replacing a core
  surface, the UI kit, and the rest.
- Replace the canonical layout at lines 16 to 30 with the plugin tree from
  [03-target-layout.md](./03-target-layout.md), marked "target; `main/` merges into `server/` in
  phase 4". Replace `frame/` with `tree/` at lines 24 and 54. Add `testkit/` and `node/schema.ts`.
- State the `contract/` versus `shared/` rule in one paragraph and point at `docs/conventions.md` (new).
- Make the manifest reference live in one place. `docs/plugin-authoring.md` section "The manifest"
  keeps the authoring view; `plugins.md` section "The manifest schema" shrinks to the fields the
  host reads and a link.

`docs/first-party-plugins.md` section "What a loaded plugin cannot have" becomes a pointer at
`docs/extensibility.md` section "Two tiers, permanently", which already makes the argument.

Add a "read this first" line to `docs/plugin-map.md` from `docs/README.md` (new); it has two inbound links
and exists to be the orientation layer.

### Renames

Use `git mv` and fix every inbound link (the path checker catches the rest):

- `docs/pg.md` moved to `docs/database.md`, or deleted if `docs/data-layer.md` section "Database
  plugin" already says everything it does. Check line by line; the review found it thinner.
- `docs/terminal-and-agents.md` moved to `docs/terminal.md`. Add one paragraph at the top saying how
  it differs from `docs/managed-agents.md` (raw provider session in a PTY versus managed session
  with a ledger) and from `docs/future/terminal/` (acorn running in a terminal).
- `docs/state.md` moved to `docs/state-ownership.md`, its own H1.
- `docs/release-notes-vnext.md` moved to `docs/release-notes.md`; the H1 already says "current".
- `docs/third-party/monaco.md` moved to `docs/editor-monaco.md`. `docs/third-party/README.md` moved
  to `docs/loaded-plugin-migration.md` and the folder deleted, so "third-party" stops meaning two
  things.

### docs/future housekeeping

- Add `refused.md` to `ecosystem/`, `sandbox/`, and `marketing/`, collecting the refusals each
  already states inline (`docs/future/ecosystem/blockers.md`, `docs/future/sandbox/phases.md`,
  `docs/future/sandbox/threat-model.md`, `docs/future/marketing/plugin-reference.md`).
- Fix the status table header date in `docs/future/README.md`.

## Out of scope

Rewriting content for accuracy beyond the moves above. Path fixes for code that has not moved yet
(phase 7 does the sweep). Merging `docs/plugin-map.md` into `docs/plugins.md`; it is a deliberate
shorter telling.

## Done when

- `docs/README.md` (new) names every file under `docs/` and `tools/arch/docPaths.test.ts` is green.
- `grep -c "^## " docs/plugins.md` is at least 24 and no h2 spans more than 400 lines.
- `docs/conventions.md` (new) exists and `CLAUDE.md` names it.
- `ls docs/third-party` fails.
- Every `docs/future/*/` programme folder has a `refused.md`.

## What shipped, and where it differed

Every item landed. Six things are worth knowing before phase 2.

**The plugin docs split further than the scope said.** Promoting the 15 h3s under `## Activation`
left one of them, "Loaded plugins: the client half", spanning 624 lines, which fails the phase's own
400-line rule. It was five top-level bullets with the whole contract indented under each, so the five
became h2s of their own — `## Frames`, `## Remote trees`, `## Document surfaces`, `## Webviews`,
`## Descriptors` — with their bodies de-indented and the intro rewritten to name them. The h3s that
were already inside those bullets came out at the right depth by themselves. `#### The tree contract`
became an h2 as well; it had been a subsection of the client half and it is a peer. Result: 34 h2s,
longest span 291 lines. Three docs cited the old section name and were repointed.

**`## The manifest schema` was holding three unrelated things.** Only the first was about the
manifest, so the Hono-and-drizzle tier decision and the testkit got h3s of their own and the section
kept the generated JSON Schema plus a new paragraph on the ten keys the host reads. The field-by-field
reference is `docs/plugin-authoring.md` § The manifest and is now the only one.

**`docs/pg.md` was moved to `docs/database.md`, not folded away.** `docs/data-layer.md` § Database plugin is better on connection
resolution and on what the SQLite file holds, but it says nothing about the `document-over-frame`
layout, the ⌘Enter chord, the optional model provider, or why the plugin declares `secrets: false`.
Deleting the file would have lost those, so it is `docs/database.md` with a corrected H1.

**"What a loaded plugin cannot have" stayed.** The scope said make it a pointer, and it cannot be one:
the six lettered reasons are what the per-plugin table below it cites, row by row. What was duplicated
was reason B's ref-panel argument, which `docs/extensibility.md` § Two tiers, permanently already
makes. Those two paragraphs are now three sentences and a link, and the concrete half — github calling
`openRefPanel` rather than rendering linear's component — moved into extensibility, which is the
sentence that migration file said this one would give up.

**`docs/conventions.md` needed a shape the draft did not have.** The draft says "Holds" or "Resolves"
per rule, which reads as a programme note rather than a rule. The owning doc states each rule in the
present tense and, where the tree does not follow it yet, adds a **Not yet everywhere** line naming
the exception and the phase that closes it. Phase 6 deletes those lines and adds which rules a test
enforces.

**The path checker caught four lines, same trap as phase 0.** A backticked repo path fails unless the
same line carries a marker such as "moved to". Renaming six files broke four lines in this folder that
name the old paths on purpose; each was reworded to say where the file went, and two of them needed
the marker moved onto the same line as the path rather than the line below. The checker was not
touched: phase 6 owns enforcement.

## Verify before building

Recorded as they were on 2026-08-30, before this phase ran. All five held.

- `docs/plugins.md` line 291 is still `## Activation` and line 2415 is still `## Task checks`.
- `docs/plugins.md` lines 24 and 54 still say `frame/`.
- `docs/pg.md` (moved to `docs/database.md`) still has zero inbound links: `grep -rn "pg.md" docs` returns only itself.
- `ls docs/future/ecosystem/refused.md` still fails.
