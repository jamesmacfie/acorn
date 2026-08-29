# Docs migration: what changes under `docs/`, and when

Part of [docs/future/layout/](./README.md). Ninety-seven markdown files were read on 2026-08-28.
This is the map of which ones change, in which phase, and what the new owning section is. The rule
from the repo's own conventions applies: **update the owning doc in the same change.** A phase is
not done until the document that owns the behaviour says the new true thing. Phase 9 does the large
rewrites; earlier phases do the sections they touch.

The 2026-08-27 reviews and the phased-review-steps programme that closed them were retired to git
history on 2026-08-28 (`git log --follow -- docs/reviews`, `-- docs/future/phased-review-steps`).
The findings this redesign answers are listed at the end of this file by review and number so the
trail survives the deletion.

## Rewrite: the core subject changes

| Document | Phase | What changes |
| --- | --- | --- |
| `docs/plugins.md` | 4, 6 partly 2026-08-30, 9 | § "Descriptors for chrome, frames for rectangles" inverts: the rule becomes "descriptors for facts, trees for UI, rectangles for pixels." § "Frame authoring and the UI kit" (Solid, `framework` key, `/ui.css`, the appearance bridge) is replaced by a section on `mountTree` and the kit — **renamed to § "Client authoring and the UI kit" in phase 5**, which turned `framework: 'solid'` into the tree preset and added the rule that a tree must not import the components barrel; the `/ui.css` and appearance-bridge paragraphs still belong to the frame and are rewritten at phase 9. § "Cooperative extension points" gains the five kinds and `kind`. § "Node-side extension points" becomes hooks. § "Loaded plugins: the client half" describes the worker. § "Replacing a core surface" and § "There is no uncooperative extension" are restated under the new model. § "The manifest schema" and the golden lists gain `kind`, `layout`, `regions`, `remote`, `hooks`. Phase 6 added the `component` carrier and the compiled `ctx.extensionPoints` and `ctx.extensions` to § "Cooperative extension points" and to the client-initialization paragraph. |
| `docs/ui-design.md` | 0, 2, 6 partly 2026-08-30, 9 | § "Primitive adoption ratchet", § "How the primitives are built", § "Migration tiers and their two invariant tests" become "The closed kit" and describe role tokens, the support matrix, and the no-class rule. § "Token axes", § "Border roles", § "Style packs" gain the role-to-value mapping and the terminal column. § "Tab strips", § "Two-column panes", § "Drag-to-resize" become pointers to layouts. § "Interaction rules", § "Menus and right-click", § "States", § "Accessibility and density" move under the intent layer. § "Icons" and § "Brand colour" survive as they are. Phase 6 added the `Rectangle` paragraph to § "The closed kit". |
| `docs/panes.md` | 1, 5 done 2026-08-30, 6 done 2026-08-30, 9 | § "Layout model" states the two layers: the task layout row (unchanged) and the pane's declared layout (new). § "Contributions" replaces the component list with `layout` and `regions`, and drops agent-tool renderers and task slots in favour of slots. § "Not a pane: the reference panel" notes the panel body is a tree. Phase 5 rewrote the region table (`remote`, `frame`, `document`), marked the four shipped panes as trees, and added the `single`-only rule for reference panels and settings pages. Phase 6 added the note that regions mount independently, so shared state lives in a per-task root, and that `Wizard` is the one layout a non-pane surface may import. |
| `docs/extensibility.md` | 9 | § "Rectangles get frames; chrome gets descriptors" is rewritten as the data-versus-code-versus-pixels argument from [01-why.md](./01-why.md). § "Plugins may extend each other, and only by invitation" gains the five kinds. § "Two tiers, permanently" and § "First-party is a reason, not a status" are updated for reason B dissolving. |
| `docs/contribution-kinds.md` | 4, 6 done 2026-08-30, 9 | The client table gains `remote`, `layout`, `hooks`; `agentToolRenderers` and `contextSectionSlots` are removed in favour of slots. Phase 6 deleted the `contextSectionSlots` row and turned the two extension-point rows into `ctx.extensionPoints` and `ctx.extensions`, with `component` as the compiled carrier. § "The slot vocabulary" is replaced by the five kinds at phase 9. |
| `docs/plugin-authoring.md` | 5 done 2026-08-30, 9 | § "The client half" leads with the tree and gained § "Drawing a tree"; the frame path is § "Appendix: the frame path", and the complete example stayed with it because a hand-written no-bundler plugin cannot import the SDK. § "The manifest" still owes the new keys at phase 9. |
| `docs/plugin-map.md` | 9 | § "The three shapes a plugin can take" becomes four (compiled, loaded, tree, frame). § "The client API" and § "Import entrypoints" gain the tree. The loaded-plugin example pushes to a tree, not a frame. |
| `docs/command-palette-and-shortcuts.md` | 2 | § "Focus and typing" is rewritten around intents, focus groups, and `@opentui/keymap` layers. § "Pane shortcuts" and § "Plugin shortcuts" describe bindings as layers. Rectangles keep the `claimsKeys` paragraph. |
| `docs/first-party-plugins.md` | 6 partly 2026-08-30, 7, 8, 9 | Reason B ("in-realm components inside another surface's tree") dissolves for everything a remote tree can carry; changes, docker's slots, onboarding's overlay, and memory move off the "must be" and "one specific reason" tables. § "First-party only by history" loses editor's blocker. Phase 6 rewrote the argument: the `remote` kind carries a real interface, and memory's section, which the section named as the proof that it could not, is a `context:section` contribution. No table row moved, and the phase file records why. |
| `docs/third-party/monaco.md` | 1, 9 | § "The template vocabulary", § "document-over-frame, concretely", § "Composed panes: decided", § "The manifest shape" fold into [05-layouts.md](./05-layouts.md) and then into `docs/panes.md`. The standing refusal "the answer stays no" on host-rendered lists is answered explicitly (see 01-why.md § One reversal). § "Language smarts" and the view-state note survive as an appendix. |
| `docs/future/split.md` | 9 | `acorn-ui` as a publishable Solid kit no longer exists as described: the kit is closed and host-owned, and plugins import it through `@acorn/plugin-api/ui` as types and a remote adapter. **Done 2026-08-28**: rewritten around `acorn-plugin-toolkit` and the SDK, with the kit's types and remote adapter published through `acorn-plugin-api`. Phase 9 only re-verifies it. |

## Update: named sections

| Document | Phase | Sections |
| --- | --- | --- |
| `docs/shell.md` | 3 done 2026-08-29, 9 | § "The plugin frame origin" stays for rectangles; a new § "The plugin worker" describes the tree sandbox. § "The renderer bridge" notes the worker transport. |
| `docs/security.md` | 3 done 2026-08-29, 4, 9 | § "The containment ladder" gained the client sandbox as rung 0, covering both the iframe and the worker rather than a rung between them — the ladder's other rungs are the node half, and the client sandbox was never on it. § "Third-party plugin bundles" states that a bundle's trust decision covers its worker. § "The vocabulary is closed, and a plugin can add to it" gains hooks and the five kinds. § "Summary table" gains rows. |
| `docs/frontend.md` | 1, 2, 9 | § "Registries and plugins" notes layouts and slots; § "Composition" notes the two render paths; § "Shell state" notes the focus store. |
| `docs/architecture-overview.md` | 0, 9 | § "Documentation map" gains this folder (done when the folder lands) and, at phase 9, the rewritten docs. § "Package boundaries" notes the kit is closed. |
| `docs/dashboards.md` | 4 | § "Placements" reconciles `pane.aside` (user panels, unchanged) with rectangle and remote slots (other plugins). |
| `docs/future/rail-tab.md` | done 2026-08-28 | § "Slice 3: loaded-plugin descriptors, NOT BUILT" is deleted; the `core:task` annotation point supersedes it. |
| `docs/third-party/README.md` | 5 done 2026-08-30, 9 | § "Monaco does not fit in a frame": the premise now opens by saying it has been overtaken, and the database section records that the lower half is a tree. § "Pick up work here" still points at this folder at phase 9. |
| `docs/agent-tools.md` | 6 done 2026-08-30, 8 | § "Context sections" gained § "Drawing inside a section": the slot is `context:section` and memory is its one contributor. The tool renderer paragraph points at `agents:tool-card` at phase 8. |
| `docs/testing.md` | 0, 3 (partly, 2026-08-29), 9 | § "Test layers" gains the kit invariants (support matrix, role mapping, no-class), the tree protocol fuzz, and the keyboard traversal test. § "The smoke checklist" gained items 17 and 18 for a remote plugin's trust flow and its failure path; keyboard-only traversal of every pane is still owed. |
| `docs/docker.md` | 6 done 2026-08-30 | Gained § "Client": both surfaces as host layouts, the container detail's tabs, the exec rectangle, and the two extension points. |
| `docs/terminal-and-agents.md` | 6 done 2026-08-30 | § "Client" says what the drawer is made of, and why its outer box is still the plugin's CSS. |
| `docs/notes-and-memory.md` | 6 done 2026-08-30 | § "Context integration" says memory draws through `context:section`. |
| `docs/plugin-map.md` | 6 done 2026-08-30, 9 | The client contribution table swapped `contextSectionSlots` for `extensionPoints` and `extensions`. |
| `docs/state.md` | 2 | § "Which mechanism holds a given fact" gains the focus and collection store (session-only). |
| `docs/diff-rendering.md` | 4, 6 partly 2026-08-30, 7 | § "Row geometry" and § "Review threads and state" gain the annotation draw site. Phase 6 opened `changes:diff-line` and gave `lineExtra` a host-owned wrapper (`.diff-line-extra`), so an owner's own annotation and a contributor's marks share one full-width line under the code. |
| `docs/features.md` | 9 | The pane list reflects layouts. |
| `docs/managed-agents.md` | 3 (the tool card, 2026-08-29), 8 | § "Client surfaces": the tool card is a slot (done); the composer has slots. |
| `docs/future/terminal.md` | done 2026-08-28 | § "The tier-2 rendering contract" and § "Decisions to carry forward" point at the tree, the kit's `tui` column, and the layouts' projections as the enabler. |
| `docs/future/remote.md` | done 2026-08-28 | § "Mobile" points at layouts' narrow projections as what makes the subset shell cheap. |
| `docs/future/compiled-tier.md` | done 2026-08-28 | § "The four couplings that need a designed seam": three of the four were component contributions and are now slots. Census updated. |
| `docs/future/dashboards/refused.md` | done 2026-08-28 | § "No plugin-shipped panel components, no widget toolkit in the wire format" is restated: still no static schema; remote trees are a different object and are not dashboard panels. |
| `docs/future/ecosystem/shell-vision.md`, `blockers.md` | done 2026-08-28 | § "The stance" and § "What is deliberately not on this list" updated for the tree. |
| `docs/future/marketing/plugin-reference.md`, `site-map.md` | 9 (the README already warns to write against the tree) | The contribution catalogue and the client-half description. |
| `docs/future/events.md` | 9 | Where they say "frame," say "frame or tree." (The "focus changed" entry already moved out of core-events into phase 2 on 2026-08-28.) Nothing about the events design itself changes. |
| `docs/future/README.md` | now, 9 | The folder index names this programme and, at phase 9, marks it shipped. |
| `docs/next-review.md`, `docs/release-notes-vnext.md` | 9 | Retarget the pointer; add release notes entries. (`live-qa.md` was folded into `docs/testing.md § The smoke checklist` on 2026-08-28; its items 11 to 16 gain keyboard and remote-plugin entries in phase 9.) |

## Fold or delete

| Document | Phase | What happens |
| --- | --- | --- |
| `docs/third-party/editor.md` | 9 | Every open item is a layout question this folder answers. The surviving facts (find-in-files is a ripgrep subprocess; the `⌘⇧F` entry point; the `claimsKeys` rule) move to `docs/panes.md` and `docs/command-palette-and-shortcuts.md`. Delete, with a pointer in `git log --follow`. |
| `docs/third-party/monaco.md` template sections | 1, 9 | Folded as above; the file shrinks to the language-smarts appendix or is deleted if nothing remains. |
| `docs/future/split.md` | 9 | Re-decided as above. |
| `docs/future/rail-tab.md` § Slice 3 | 4 | Deleted. |

## Reviews: the evidence, not the plan

The review files are in git history, not the tree, so there is nothing to annotate. For the trail,
these are the 2026-08-27 findings this programme answers, by file and number as the reviews
numbered them:

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
