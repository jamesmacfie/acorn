# Phase 11: rehome the design, then delete the folder

Status: not started. Follows phase 10, because two of its sections depend on phase 10's decisions
(the region seam and the annotation sites). At the end of this phase `docs/future/layout/` does not
exist and `tools/arch`'s `docPaths` test is green.

## Goal

Every fact in this folder that is still true has one owning doc under `docs/`, every doc and source
comment that links here links there instead, and the three owning-doc sections that still describe
the frames-only world are rewritten. Then `git rm -r docs/future/layout`.

## Why this is a phase and not a chore

The folder's README says the owning docs win, and four owning docs delegate ownership back to the
folder: `docs/ui-design.md:328` for the 80-column sentence per node, `docs/panes.md:64` for every
layout's projections, `docs/plugins.md:898` for the layout set and `:1639` for the wire format. Delete
the folder today and the terminal and PWA designs (`docs/future/terminal.md`, `docs/future/remote.md`)
lose the only written record of what they need from the desktop implementation.

## Scope

### Move: content that exists only here

| Content | From | To |
| --- | --- | --- |
| The per-node table: props, focus role, rendering at 80×24 | 04-kit.md § The node set | `docs/ui-design.md § The closed kit`, as an appendix. Correct it while moving: `Slot` is not a kit node, `Image` never shipped, `Avatar` is `UserAvatar`, `Toggle` is `ToggleButton`, and the 21 nodes added since (phase 5 deviation 2, `Rows`, `Rectangle`, `ConfirmButton`, `Popover`, the column and modal parts) need rows. Generate the node list from `ui/kit/support.ts` rather than typing it, and add a test that every `NODE_SUPPORT` key has a row in the doc, the same shape as `docPaths`. |
| The admission rule, four conditions | README § The admission rule | `docs/ui-design.md § The closed kit` for nodes, `docs/panes.md § Layout model` for layouts. |
| Each layout's regions, narrow projection, terminal projection | 05-layouts.md | `docs/panes.md § Layout model`, replacing the delegation at `:62-64`. Eight names, seven components; say so once. If phase 10 item 7 struck the narrow projection, this row shrinks to the terminal column. |
| The wire format: node shape, five mutation kinds, the eleven events, lifecycle, validation rules, caps, throttling | 06-remote-tree.md §§ The wire format, Validation | `docs/shell.md § The plugin worker` for the sandbox half is done; the contract half needs a home. Put it in `docs/plugins.md § Loaded plugins: the client half` under a "The tree contract" heading, next to the frame bridge verbs it parallels, and cite `packages/protocol/src/tree/`. |
| The five kinds cost table and the "which kind do I want" order | 03-extension-kinds.md | `docs/plugins.md § Cooperative extension points` has the order; add the cost table. |
| The "never do these" list and the PWA and terminal checklists | 09-doors-left-open.md | `docs/ui-design.md`, a new § "What the kit and layouts must never do", with the PWA and terminal halves pointed at from `docs/future/remote.md` and `docs/future/terminal.md`. These are standing constraints, not future work, so they leave `docs/future/`. |
| The refused arguments | refused.md | Split by owner. Iframes in iframes, free `postMessage`, nested slots, reopening `frame-src`: `docs/security.md`. Styling props, raw scale values, plugin-positioned layout, hover, controlled and uncontrolled mixed: `docs/ui-design.md § The closed kit`. A second keymap: `docs/command-palette-and-shortcuts.md` (cited today by `docs/future/client-plugins/refused.md:57`). Per-item remote trees at volume, the hidden iframe sandbox, first-party through the remote root: `docs/plugins.md`. Native iOS and agents-first are history and go with the folder. |
| Static schema versus component tree; the monaco.md reversal | 01-why.md | `docs/plugins.md § Descriptors for facts, trees for UI, rectangles for pixels`. `docs/future/terminal.md:16` and `docs/future/dashboards/refused.md:17` link to these two sections by name. |
| What crosses to a terminal, and what does not | 02-survey.md § What crosses | `docs/future/terminal.md`, which is the only reader. |
| Where plugin-declared point ids live | not written anywhere | `docs/plugins.md § Cooperative extension points`: the owner's `extensionPoints.ts` holds the id, `@acorn/protocol` holds the ids core's own consumers say, and a contributor spells the string. |

Everything else in the folder is either in an owning doc already (the hook contract, the focus model,
the arbitration table, the role mapping, the two render paths) or is history (the survey counts,
the phase plans, the deviation lists). History goes with the folder; `git log --follow` is the record,
as `docs/future/README.md` says.

### Rewrite: sections still in the old world

- `docs/extensibility.md § "Rectangles get frames; chrome gets descriptors"`: the heading and the
  argument are unchanged from before the programme. Rewrite as data, code, and pixels.
  § "Plugins may extend each other, and only by invitation" describes only the rows kind.
  § "Plugins get building blocks" says rollbar's frame opts into Solid at build time and the
  transform is per package; the key was deleted in phase 9 and rollbar is a tree.
- `docs/plugins.md § "There is no uncooperative extension"`, `:2022-2028`: says memory's section
  "stays a compiled-tier component" and "both registries" are populated from manifests. Memory is a
  `context:section` contribution and there is one registry.
- `docs/third-party/monaco.md § "Composed panes: decided"` still describes `.db-editor-host` and
  `.db-split` classes that were deleted with database's stylesheet; § "The manifest shape" never
  folded. Either fold both into `docs/panes.md` and shrink the file to the language-smarts appendix,
  as docs-migration.md said, or delete it.
- `docs/ui-design.md § "Two-column panes"` says a pane that wants to stack "declares it on its own
  class"; § "Drag-to-resize" is the pre-layout description. Both become pointers at
  `docs/panes.md § Layout model`.
- `docs/contribution-kinds.md § "The slot vocabulary"` was to be replaced by the five kinds and was
  not; the `UiSlotId` table survives because the descriptor slot registry survives. Either replace
  the heading and keep the table under "Descriptor slots", or record that the two-spelling table
  stays and why.

### Small fixes

- `docs/testing.md:276`: the folder is neither untracked nor in progress. Delete the bullet.
- `docs/architecture-overview.md § Package boundaries`: say the kit is closed.
- `docs/plugin-map.md § Import entrypoints`: add the `@acorn/plugin-api/ui/tree` row and the rule
  that a tree must not import the `/ui` barrel.
- `docs/plugins.md:96` and `:157`: `mountTree` beside `mountFrame`.
- `docs/plugin-authoring.md:180`: the cross-reference names the old section title.
- `docs/first-party-plugins.md:163`: `WORKTREE_CREATED` is the `core:worktree-created` hook, not one
  of terminal's capabilities.
- `docs/future/remote.md:89`: eight layouts, not six.
- `docs/future/split.md:61` and `:129-131`: future tense against shipped phases.
- `docs/future/marketing/site-map.md:15` quotes "rectangles get frames; chrome gets descriptors" as a
  differentiator; `plugin-reference.md:74-88` still calls `frames` "sandboxed iframe targets".
- `docs/first-party-plugins.md`: the "must be" table still cites reason B for terminal, docker, and
  onboarding. Phase 6 deviation 9 explains why they stayed; that explanation lives only in this folder,
  so either move the sentence into the table's footnote or move the rows.

### Repoint 70 inbound links

22 doc lines and 53 source comments link into the folder (`grep -rn "future/layout" docs packages
plugins apps`). Each moves to the owning section named above. The heaviest targets, by count:
06-remote-tree.md (20 source files), 07-focus-and-keys.md (9), 04-kit.md (8), 05-layouts.md (5),
phase-8-agents.md (4). `tools/arch/docPaths.test.ts` fails on every doc link that does not resolve,
so run it last and it is the done check for the doc half. Source comments are not checked by
anything; grep is the check.

### Delete

`git rm -r docs/future/layout`, including this `review/` folder. Update `docs/future/README.md`: the
layout row moves to § Retired folders with one sentence on where the behaviour lives.

### Memory notes

docs-migration.md § Memory notes to revisit names four entries in the owner's memory index. The
plugin-api facade note needs `/ui/tree` added to its list of entrypoints. The "vitest cannot render
components" note stays true for plugins until phase 10 item 11 lands, then needs the plugin `hosts`
project. The `<For>` versus `<Index>` note gains one line: `Rows` reconciles by key, so a `Rows`
collection has neither problem. The clipboard note is unchanged; it is about frames and frames
survive.

## Done when

- `docs/future/layout/` does not exist.
- `grep -rn "future/layout" docs packages plugins apps` finds nothing.
- `pnpm test --filter tools` (the arch project, including `docPaths`) is green.
- `docs/ui-design.md § The closed kit` has a row per `NODE_SUPPORT` key, and a test says so.
- `docs/panes.md § Layout model` carries both projections for every layout, or the terminal one
  alone if phase 10 struck narrow.
- Every doc in the "Rewrite" list above describes the tree world.

## Verify before building

- Phase 10 items 6 and 7 are decided; the projection and rail-tab rows here depend on them.
- `docs/ui-design.md:328`, `docs/panes.md:64`, `docs/plugins.md:898` and `:1639` still point at this
  folder.
- `docs/extensibility.md § "Rectangles get frames; chrome gets descriptors"` still has that heading.
- `tools/arch/docPaths.test.ts` still checks relative links between docs and repo-rooted paths in
  backticks, and still excludes nothing under `docs/future/`.
