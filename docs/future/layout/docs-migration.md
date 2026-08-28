# Docs migration: what changes under `docs/`, and when

Part of [docs/future/layout/](./README.md). Ninety-seven markdown files were read on 2026-08-28.
This is the map of which ones change, in which phase, and what the new owning section is. The rule
from the repo's own conventions applies: **update the owning doc in the same change.** A phase is
not done until the document that owns the behaviour says the new true thing. Phase 9 does the large
rewrites; earlier phases do the sections they touch.

Reviews under `docs/reviews/` are historical records. They are never edited beyond a one-line
"superseded by" header, and they are the evidence this redesign answers.

## Rewrite: the core subject changes

| Document | Phase | What changes |
| --- | --- | --- |
| `docs/plugins.md` | 4, 9 | § "Descriptors for chrome, frames for rectangles" inverts: the rule becomes "descriptors for facts, trees for UI, rectangles for pixels." § "Frame authoring and the UI kit" (Solid, `framework` key, `/ui.css`, the appearance bridge) is replaced by a section on `mountTree` and the kit. § "Cooperative extension points" gains the five kinds and `kind`. § "Node-side extension points" becomes hooks. § "Loaded plugins: the client half" describes the worker. § "Replacing a core surface" and § "There is no uncooperative extension" are restated under the new model. § "The manifest schema" and the golden lists gain `kind`, `layout`, `regions`, `remote`, `hooks`. |
| `docs/ui-design.md` | 0, 2, 9 | § "Primitive adoption ratchet", § "How the primitives are built", § "Migration tiers and their two invariant tests" become "The closed kit" and describe role tokens, the support matrix, and the no-class rule. § "Token axes", § "Border roles", § "Style packs" gain the role-to-value mapping and the terminal column. § "Tab strips", § "Two-column panes", § "Drag-to-resize" become pointers to layouts. § "Interaction rules", § "Menus and right-click", § "States", § "Accessibility and density" move under the intent layer. § "Icons" and § "Brand colour" survive as they are. |
| `docs/panes.md` | 1, 9 | § "Layout model" states the two layers: the task layout row (unchanged) and the pane's declared layout (new). § "Contributions" replaces the component list with `layout` and `regions`, and drops agent-tool renderers and task slots in favour of slots. § "Not a pane: the reference panel" notes the panel body is a tree. |
| `docs/extensibility.md` | 9 | § "Rectangles get frames; chrome gets descriptors" is rewritten as the data-versus-code-versus-pixels argument from [01-why.md](./01-why.md). § "Plugins may extend each other, and only by invitation" gains the five kinds. § "Two tiers, permanently" and § "First-party is a reason, not a status" are updated for reason B dissolving. |
| `docs/contribution-kinds.md` | 4, 9 | The client table gains `remote`, `layout`, `hooks`; `agentToolRenderers` and `contextSectionSlots` are removed in favour of slots. § "The slot vocabulary" is replaced by the five kinds. |
| `docs/plugin-authoring.md` | 5, 9 | § "The client half", § "Reaching the bridge", § "What the bridge carries", and the complete example move to `mountTree` and a tree plugin; the frame path becomes an appendix for rectangle plugins. § "The manifest" gains the new keys. |
| `docs/plugin-map.md` | 9 | § "The three shapes a plugin can take" becomes four (compiled, loaded, tree, frame). § "The client API" and § "Import entrypoints" gain the tree. The loaded-plugin example pushes to a tree, not a frame. |
| `docs/command-palette-and-shortcuts.md` | 2 | § "Focus and typing" is rewritten around intents, focus groups, and `@opentui/keymap` layers. § "Pane shortcuts" and § "Plugin shortcuts" describe bindings as layers. Rectangles keep the `claimsKeys` paragraph. |
| `docs/first-party-plugins.md` | 6, 7, 8, 9 | Reason B ("in-realm components inside another surface's tree") dissolves for everything a remote tree can carry; changes, docker's slots, onboarding's overlay, and memory move off the "must be" and "one specific reason" tables. § "First-party only by history" loses editor's blocker. |
| `docs/third-party/monaco.md` | 1, 9 | § "The template vocabulary", § "document-over-frame, concretely", § "Composed panes: decided", § "The manifest shape" fold into [05-layouts.md](./05-layouts.md) and then into `docs/panes.md`. The standing refusal "the answer stays no" on host-rendered lists is answered explicitly (see 01-why.md § One reversal). § "Language smarts" and the view-state note survive as an appendix. |
| `docs/future/split.md` | 9 | `acorn-ui` as a publishable Solid kit no longer exists as described: the kit is closed and host-owned, and plugins import it through `@acorn/plugin-api/ui` as types and a remote adapter. Rewrite around `acorn-plugin-toolkit` and the SDK, or fold into `phased-review-steps/phase-6`. |

## Update: named sections

| Document | Phase | Sections |
| --- | --- | --- |
| `docs/shell.md` | 3, 9 | § "The plugin frame origin" stays for rectangles; a new § "The plugin worker" describes the tree sandbox. § "The renderer bridge" notes the worker transport. |
| `docs/security.md` | 3, 4, 9 | § "The containment ladder" gains the worker as a rung between "descriptor" and "iframe." § "Third-party plugin bundles" states that a bundle's trust decision covers its worker. § "The vocabulary is closed, and a plugin can add to it" gains hooks and the five kinds. § "Summary table" gains rows. |
| `docs/frontend.md` | 1, 2, 9 | § "Registries and plugins" notes layouts and slots; § "Composition" notes the two render paths; § "Shell state" notes the focus store. |
| `docs/architecture-overview.md` | 0, 9 | § "Documentation map" gains this folder (done when the folder lands) and, at phase 9, the rewritten docs. § "Package boundaries" notes the kit is closed. |
| `docs/dashboards.md` | 4 | § "Placements" reconciles `pane.aside` (user panels, unchanged) with rectangle and remote slots (other plugins). |
| `docs/future/rail-tab.md` | 4 | § "Slice 3: loaded-plugin descriptors, NOT BUILT" is deleted; the `core:task` annotation point supersedes it. |
| `docs/third-party/README.md` | 5, 9 | § "Monaco does not fit in a frame, and that ends two migrations": the premise is removed; database and editor now have a path. § "Pick up work here" points at this folder. |
| `docs/agent-tools.md` | 6, 8 | § "Context sections" notes `contextSectionSlots` is a slot; the tool renderer paragraph points at `agents:tool-card`. |
| `docs/testing.md` | 0, 9 | § "Test layers" gains the kit invariants (support matrix, role mapping, no-class), the tree protocol fuzz, and the keyboard traversal test. § "The smoke checklist" gains keyboard-only traversal of every pane and the trust flow for a remote plugin. |
| `docs/state.md` | 2 | § "Which mechanism holds a given fact" gains the focus and collection store (session-only). |
| `docs/diff-rendering.md` | 4, 7 | § "Row geometry" and § "Review threads and state" gain the annotation draw site. |
| `docs/features.md` | 9 | The pane list reflects layouts. |
| `docs/managed-agents.md` | 8 | § "Client surfaces": the tool card is a slot; the composer has slots. |
| `docs/future/terminal.md` | 9 | § "The tier-2 rendering contract" and § "Decisions to carry forward" point at the tree, the kit's `tui` column, and the layouts' projections as the enabler. |
| `docs/future/remote.md` | 9 | § "Mobile" points at layouts' narrow projections as what makes the subset shell cheap. |
| `docs/future/compiled-tier.md` | 9 | § "The four couplings that need a designed seam": three of the four were component contributions and are now slots. Census updated. |
| `docs/future/dashboards/refused.md` | 4 | § "No plugin-shipped panel components, no widget toolkit in the wire format" is restated: still no static schema; remote trees are a different object and are not dashboard panels. |
| `docs/future/ecosystem/shell-vision.md`, `blockers.md` | 9 | § "The stance" and § "What is deliberately not on this list" updated for the tree. |
| `docs/future/marketing/plugin-reference.md`, `site-map.md` | 9 | The contribution catalogue and the client-half description. |
| `docs/future/events/README.md`, `delivery.md`, `subscriptions.md`, `core-events.md` | 9 | Where they say "frame," say "frame or tree." § "Focus changed" in core-events notes focus is host-owned state. Nothing about the events design itself changes. |
| `docs/future/phased-review-steps/README.md` | now | A pointer row to this folder in the phases table's surroundings (not a numbered phase; a sibling programme). |
| `docs/future/phased-review-steps/phase-6-distribution-and-third-party.md` | 9 | § 6.2 notes split.md's re-decision. |
| `docs/future/phased-review-steps/phase-3-plugin-api-integrity.md` | 9 | A superseded-by line on § 3.5 (the contribution-kind table). |
| `docs/smolforge/README.md`, `phase-4-smolforge-plugin.md` | 9 | § "What the loaded-plugin tier already covers" and the client registration summary mention trees. |
| `docs/future/live-qa.md`, `docs/next-review.md`, `docs/release-notes-vnext.md` | 9 | Retarget the pointer; add release notes entries. |

## Fold or delete

| Document | Phase | What happens |
| --- | --- | --- |
| `docs/third-party/editor.md` | 9 | Every open item is a layout question this folder answers. The surviving facts (find-in-files is a ripgrep subprocess; the `⌘⇧F` entry point; the `claimsKeys` rule) move to `docs/panes.md` and `docs/command-palette-and-shortcuts.md`. Delete, with a pointer in `git log --follow`. |
| `docs/third-party/monaco.md` template sections | 1, 9 | Folded as above; the file shrinks to the language-smarts appendix or is deleted if nothing remains. |
| `docs/future/split.md` | 9 | Re-decided as above. |
| `docs/future/rail-tab.md` § Slice 3 | 4 | Deleted. |

## Reviews: the evidence, not the plan

Add one line under the title of each: "Superseded in part by `docs/future/layout/`; see
docs-migration.md § Reviews." Then, so the trail is legible, the findings this programme answers:

- `2026-08-27-plugin-surface-consistency.md` § 2 (two slot registries hold the same type): the five
  kinds replace the slot vocabulary.
- `2026-08-27-plugin-surface-adversarial.md` § 2 (the only tier a stranger can write is untyped
  JavaScript), § 4 (the two tiers overlap rather than nest), § 5 (`ctx.contribute` means the counted
  surface is not the real one): one component API with two render paths; slots replace the escape
  hatch for UI.
- `2026-08-27-architecture-review.md` § 1 (nothing verifies the user interface): the kit and layout
  invariants and the jsdom host tier extend to every pane; § 5 (two plugin APIs, not one with two
  trust levels): answered by the two render paths over one API; § 7 (docs carry a second
  implementation of the design): this migration file is the discipline.
- `2026-08-27-extensibility-adversarial.md` § 8 (client capability gating is a closed two-key type):
  the support matrix is the successor.
- `2026-08-27-security-review.md`: no finding is answered here; the worker rung is added to the
  ladder in `security.md`.

## Memory notes to revisit at the end

Not repo docs, but the owner's memory index carries entries that describe the frames-only world and
stay true until phase 9: the plugin-api facade note, the frame SDK clipboard note, the "vitest
cannot render components" note, and the `<For>` versus `<Index>` defocus note (which the host-owned
collection store makes structural). Review them when phase 9 lands.
