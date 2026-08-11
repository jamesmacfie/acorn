# Shared UI components — gap analysis and proposals

Design notes from a full survey of every plugin's client/frame UI and the core shell
(2026-08-11). Each file in this folder proposes one shared Solid component for the design-system
layer (`packages/client-core/src/ui`, exported via `@acorn/plugin-api/ui`): why it should exist
(with the current call sites as evidence), how to build it inside the house rules, and which code
should be refactored onto it. Nothing here is scheduled.

## What the survey found

The shared layer is small and well-built: nine primitives (`Button, Input, Select, Textarea,
Field, Badge, Spinner, SectionHeader, Row`), `Modal`/`Tabs`/`Picker`/`Icon`/`CopyButton`/
`MentionTextarea`/`UserAvatar`, the diff toolkit, and three behaviour hooks (`createDismissable`,
`createOverlayPalette`, `focus.ts`). Adoption is wildly uneven — http and rollbar use nearly
everything; docker, terminal, preview, notes, memory, and most of the shell use nearly nothing —
and the gaps force every surface to hand-roll the same fifteen patterns. Highlights:

- ~14 error-banner implementations; the de-facto shared class `.action-error` is used in 32 files
  (17 in client-core) but **defined only in the GitHub plugin's stylesheet**
- ~35 empty/loading states, all bare text, several borrowing other plugins' classes
- 10+ status-dot implementations with two competing colour-token vocabularies
- 5 arm-to-confirm delete implementations, plus `window.confirm` in a codebase that documents why
  not to use it, plus plugins that confirm nothing
- 4 menus (none with full dismiss/ARIA behaviour), 4 popover anchoring strategies, 4 identical
  copies of the palette markup, 15+ toolbars, 10 card rules, 9 key-value grids, 9 mono-block
  rules, 6 segmented controls, 3 drag-splitters, 12+ raw checkboxes no style pack can reach

## The proposals

Ordered by leverage. "Deps" = other proposals that should land first.

| Tier | Component | One-liner | Deps |
|---|---|---|---|
| 1 | [alert](./alert.md) | Toned inline/banner feedback; fixes the `.action-error` inversion | — |
| 1 | [empty-state](./empty-state.md) | Empty/loading/unconfigured pane states, ~35 sites | — |
| 1 | [status-dot](./status-dot.md) | The state circle; settles the status-token vocabulary | — |
| 1 | [checkbox](./checkbox.md) | Styled checkbox (+switch); the control packs can't reach today | — |
| 1 | [confirm-button](./confirm-button.md) | Arm-to-confirm destructive Button + hook | — |
| 1 | [popover](./popover.md) | Anchoring hook extracted from Picker + surface | — |
| 2 | [menu](./menu.md) | Dropdown/context menu with real semantics | popover |
| 2 | [toolbar](./toolbar.md) | The bar strip + Spacer; kills the margin-left:auto hacks | — |
| 2 | [chip](./chip.md) | Interactive/removable/colour-driven tag beside Badge | — |
| 2 | [tooltip](./tooltip.md) | Promote RailTips' `data-tip` protocol to the app contract | — |
| 2 | [toast](./toast.md) | Transient feedback; unifies with the frame bridge toast | — |
| 2 | [description-list](./description-list.md) | Label/value `<dl>` in columns and facts layouts | — |
| 2 | [collapsible-section](./collapsible-section.md) | SectionHeader + disclosure + persistKey | — |
| 2 | [segmented-control](./segmented-control.md) | Radio-group segments + ToggleButton | — |
| 2 | [search-input](./search-input.md) | `Input kind="filter" / "bare"` variants | — |
| 2 | [kbd](./kbd.md) | The keycap | — |
| 3 | [card](./card.md) | Bordered surface, interactive/stripe variants | — |
| 3 | [document-tabs](./document-tabs.md) | Closable/dirty/status tab strip (editor, terminal) | status-dot |
| 3 | [tree-row](./tree-row.md) | Disclosure row with depth, built on Row | — |
| 3 | [find-bar](./find-bar.md) | In-content search strip with the ⏎/⇧⏎/Esc contract | toolbar, kbd |
| 3 | [drawer](./drawer.md) | Side-anchored Modal sibling on createDismissable | — |
| 3 | [split-handle](./split-handle.md) | Drag-resize hook + handle | — |
| 3 | [code-block](./code-block.md) | Mono sunken block with copy affordance | — |
| 3 | [meter](./meter.md) | Ratio bar with a11y and pack-styleable fill | — |
| 3 | [key-value-editor](./key-value-editor.md) | Editable rows grid (http's, given a home) | checkbox |
| 3 | [table](./table.md) | Thin token-styled `<table>` for the genuinely tabular | — |
| 3 | [composer](./composer.md) | Comment box: textarea + actions + error + chord | toolbar, kbd |
| 3 | [palette-surface](./palette-surface.md) | The palette markup, deduped ×4 | — |
| 4 | [skeleton](./skeleton.md) | Row-shaped shimmer; deliberately last, maybe never | empty-state |

Tier 1 also fixes correctness/ownership defects (inverted CSS dependencies, missing focus traps,
unstyled-in-frame classes), not just duplication.

## Extensions to existing components

Small upgrades that surveys showed are the *reason* sites bypass the shared layer. Each is a few
lines, not a new file:

- **Button**: `href` support (renders `<a class="ui-btn">` — today hand-written at
  `GithubConnect.tsx:52`); a documented `pressed` story (or ToggleButton, see segmented-control);
  fix the invalid `data-size="xs"` usage at `ChromeBadge.tsx:45` (either add `xs` or correct the
  call site).
- **Modal**: `autoFocus?: () => HTMLElement` — the `queueMicrotask` focus idiom is duplicated
  with identical comments in `GenerateSqlModal.tsx:82` and `SaveQueryModal.tsx:66`.
- **Tabs**: an `actions` trailing slot (http and editor both fight `.ui-tabs` CSS to bolt
  controls beside the strip) and a `Tabs.Panel` helper (rollbar hand-writes the 6-attribute panel
  boilerplate twice; terminal skipped Tabs entirely).
- **Row**: hover-revealed `trailing` (`data-reveal` — the visibility-on-hover idiom is
  implemented 5×: `pull-list.css:80`, `pull-detail.css:236`, `http.css:71`, `changes.css:47`,
  `docker.css:47`); `href` rendering (github's `.pr-row` is an `<A>`); a `variant`/shape story so
  rollbar's three `.ui-row` overrides become tokens.
- **Badge**: nothing — colour-driven pills go to [Chip](./chip.md); keep Badge static.
- **Textarea**: `mono` variant to retire `.settings-script` (see code-block.md).
- **CopyButton**: injectable copy function so sandboxed frames (no `navigator.clipboard`) can use
  it with the bridge — the documented blocker at `HttpPanel.tsx:186-190` and `linear/app.tsx:127`.
- **Spinner**: no API change; adoption push — preview renders `<span class="preview-spinner spin">◐</span>`
  with no accessible name, and github/docker/database render busy states as literal strings.

## Deliberately not proposed

Compared against the shadcn and Bootstrap catalogues, these have no evidence in the codebase:

Accordion-with-exclusivity (no consumer), Breadcrumb (zero occurrences; the topbar crumb is shell
chrome), Pagination (one load-more button — leave it), Radio group (zero radios; Picker/Select/
segments cover choice), Slider, Calendar/DatePicker, InputOTP, Carousel, HoverCard (tooltip/
popover cover it), NavigationMenu/Sidebar/Navbar (shell-owned chrome, not plugin surface),
ScrollArea (native overflow + hidden scrollbars are a global decision already), AspectRatio,
Avatar (UserAvatar exists), Dialog (Modal exists), Form (Field exists), Command (createOverlayPalette
+ palette-surface), Resizable panels container (split-handle covers the shareable part), Stepper
(one wizard; its dots stay local).

## House rules every proposal assumes

- Components are pure presentation — props in, DOM out — enforced by
  `tools/arch/boundaries.test.ts`; anything needing shell state goes to `connected/` wrappers or
  `/ui/host`. Behaviour that isn't a component ships as a hook (`createDismissable` precedent).
- CSS lives in the shared role sheets (usually `styles/primitives.css`) as `.ui-*` classes with
  `data-*` variants; tokens only — `cssHygiene.test.ts` rejects literals, and new tokens must be
  classified in `ui/tokenAxes.ts` or its disjointness tests fail. Base rules at (0,1,0), variants
  (0,2,0), pack overrides (0,3,0).
- `primitives.css` is served to sandboxed plugin frames
  (`apps/desktop/src/app/main/pluginFrameStyles.ts`) — putting shared CSS there is the whole
  frame-distribution story; putting it anywhere else requires touching the allowlist.
- Every component appends `props.class` via `cx()` (`adoption.test.ts` enforces it) so migrated
  call sites can keep their old class and render identically mid-migration.
- Frame-safe exports go on `@acorn/plugin-api/ui`; host-only ones on `/ui/host`. The barrel rules
  in `boundaries.test.ts` decide, not taste.
- Migration is ratcheted, not big-bang: convert a file, add it to `CONVERTED` in
  `packages/client-core/src/ui/adoption.test.ts`, and when a bespoke class is fully retired add
  it to the retired-class regex. Consider extending the ledger to also catch raw
  `class="ui-btn"`/`data-variant` strings — the dominant bypass in the shell today (44 sites) —
  once Button adoption starts in earnest.

## Structural fixes to carry alongside (not components, but found by the same survey)

- Cross-plugin CSS dependencies to sever: notes → editor (`.editor-empty`, `.editor-save`) and →
  github (`.action-error`, `.linear-md`); docker → github (`.new-pr-btn`); database → github
  (`.pr-filter`, dead in-frame); everyone → github (`.action-error`); core → github
  (`.checks-dot`, `.user-avatar`). Each is resolved by a Tier 1–2 component above.
- Ownership inversions: preview's chrome is styled entirely by core's `task-view.css`; context's
  stylesheet styles memory's markup.
- Undefined classes in use: `.wizard-primary`, `.project-importer`, `.tabrail-action-error`,
  `.overlay-actions`, `.sr-only` (needs a real rule), `.home-*` family.
- Dead CSS: `~40` lines in `terminal.css`, `.wizard-field`, `.terminal-menu-wt`.
- Stale directories: `plugins/profiles-{aider,claude,codex}` are deleted packages with only
  `dist/`/`.turbo/` residue on disk — remove them; they derail every future inventory.
- Four different `:disabled` opacities (.35/.4/.45/.5) converge automatically as Button adoption
  proceeds.
