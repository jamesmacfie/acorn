# UI design

acorn's UI is a dense keyboard-driven workspace. The visual system separates semantic theme tokens
from style-pack geometry so a user can choose color and shape/density independently.

## Shell hierarchy

```text
Topbar: Node/workspace context, repo/PR controls, global actions
TabRail: sources → workspaces → tasks
Main: Home, Fleet overview, source browse, or active task
Task: ordered pane row
Bottom drawer: terminals and raw provider sessions
Overlays: palette, settings, onboarding, notices, confirmations
```

The shell owns navigation chrome and modal prompts. Plugins supply feature content through registries
and slots. A native preview view is positioned over a pane host by Electron main; page content never
owns the surrounding chrome.

## Appearance

Themes provide semantic colors for backgrounds, text, borders, accents, diff states, notices, and
focus. Style packs provide typography, radius, spacing, density, chrome, and motion. The two choices
compose without feature components selecting literal colors. CSS variables are the runtime contract;
feature CSS is scoped to its plugin.

All 12 shipped themes and 4 style packs are registered literals and covered by parity tests. Device
preferences persist locally; they do not depend on which Node is active.

### Plugin themes

A plugin may contribute a **colour** theme, and only as data. `contributions.themes` in
`acorn-plugin.json` is a map of theme-token values; the host validates it and generates the
`:root[data-theme="plugin:<pluginId>:<themeId>"]` block itself
(`client-core/src/plugins/chrome/themes.ts`). **No plugin-authored CSS ever reaches the shell.** The
theme cannot break shape, density or layout because it cannot express anything but colour, which is
what makes this seam cheap: there is no stylesheet to parse and no selector to confine.

The token contract splits three ways, and only the first is declarable:

| Group | Count | Who writes it |
| --- | --- | --- |
| **Palette primitives** (`--bg`, `--text`, `--accent`, `--del-marker`, …) | 22 | The manifest, in full. `@acorn/protocol/themeTokens.ts` is the list, so the node can refuse an incomplete map at parse time without importing the client. |
| **Derived** (`--danger`, `--surface-sunken`, `--state-ok`, …) | 12 | `:root`, once, as `var()` references into the palette — so they follow every theme for free. A manifest naming one is refused: restating it in a theme block is what would break the derivation. |
| **Self-description** (`--is-dark`, `--color-scheme`, `--syntax-fg`) | 3 | The host, from the theme's one `dark` boolean. They are not colours, so they cannot go through the colour check, and a theme that could set them could tell the terminal it was dark while rendering a light palette. |

Validation is "every primitive present, no unknown key, every value a hex colour or a flat colour
function". Named colours, `var()` and nested functions (`url(…)`, `calc(…)`) are refused: the value
alphabet is the injection gate, so a value that passes cannot close a declaration, close the block or
open a tag. Both ends check — the node when it parses the manifest, the client again immediately
before generating CSS, because a roster row is bytes a node sent.

Ids are namespaced `plugin:<pluginId>:<themeId>`, so a plugin can never redefine a built-in and two
plugins can ship the same theme name. They appear in Settings → Appearance beside the built-in twelve,
labelled with their owner. **A stored preference naming a theme that is not registered right now falls
back to Light/Dark and is never rewritten** — a disabled plugin, an untrusted bundle and an unreachable
node all arrive as the same absence, and a preference erased on the third cannot be recovered when the
node comes back. The theme returns by itself when the plugin does.

**Style packs are deliberately not contributable.** Style tokens touch layout and density, where
"cannot break the app" is a much weaker promise than it is for colour. The mechanism would be the same;
the judgement is not, and one contribution never spans both axes.

Feature-owned styles live beside the feature components that consume them. For example, the GitHub
pull list, pull detail, and checks panel import their own plugin styles; genuinely shared integration
settings remain in the client-core `integrations.css` role sheet. This keeps plugin presentation out
of the core aggregate without changing tokens or selector behavior.

## Primitive adoption ratchet

`packages/client-core/src/ui/adoption.test.ts` tracks the incremental migration from hand-written
controls to the shared UI primitives. Its `CONVERTED` list may only grow; every listed file must
avoid raw buttons, selects, textareas, and retired shared classes. New components should use the
primitives from the start, and the retired-class check must remain clean while older surfaces are
migrated.

## Icons

`ui/Icon.tsx` takes a **name string** and resolves it against two families, in this order:

1. A **`brand:`-prefixed name** is a brand mark from `ui/brandMarks.ts`: one SVG path's `d`
   attribute in a 24 box, drawn as a single `<path fill="currentColor">`.
2. Any **other name** is a Lucide glyph from `lucide-static/icon-nodes.json`, drawn stroked and
   unfilled in the same box, node by node through `<Dynamic>` and never `innerHTML`.
3. An **unmatched name renders as text** in a `span.glyph`. That fallback is load-bearing rather
   than a nicety — the remaining inline literals (◆/◇ pin state, ⊘/◉ hidden) ride it, which is also
   why `--font-glyph` survives the brand marks leaving.

The `brand:` prefix exists so the two families can never collide (Lucide has grown brand-shaped
names before and will again) and so brand marks stay out of `ICON_NAMES`, which `ui/IconPicker.tsx`
enumerates for user-chosen workspace and task icons. Putting them in that picker is then a
deliberate one-line decision rather than something that happens by accident.

**A mark belongs in core if and only if a core surface renders it.** Otherwise it belongs to the
plugin that draws it. The reason is the text fallback: if core names `brand:x` and no plugin has
registered it — disabled, uninstalled, bundle untrusted — the literal string `brand:x` appears in
the UI. Core's list is currently one entry, GitHub, because `project.github` is a first-class field
on the project row and core draws it. The mark follows the data model, not the plugin boundary.

A plugin supplies its own mark through one of two feeders, and they produce identical results:

- **compiled in** — call `brandMarkRegistry.register()` from the plugin's `init`
  (`@acorn/plugin-api/client`); see `plugins/docker/src/client/index.ts`.
- **loaded** — declare `icon` (or `icons`, for a package hosting several brands) at the top level
  of `acorn-plugin.json`; the host registers it under a name it stamps from the roster row, so a
  package cannot claim another's mark. See `plugins/linear/acorn-plugin.config.mjs`.

Because both feeders end at the same registry, a plugin moving from compiled-in to loaded changes
no glyph string anywhere. Path data rather than a component is what makes that true: a loaded
plugin's client bundle runs in a sandboxed iframe on its own origin, and a function cannot cross a
MessagePort — and a rail source's logo has to draw whether or not that plugin's frame is mounted.
The retired design note (`docs/future/icons.md`, in git history) records the alternatives this
rules out.

## Two-column panes

A pane that puts a list beside a detail uses the `ListDetail` primitive, not a hand-rolled grid. It
owns the split, the two column widths (`narrow` for an identifier switcher, the default for a browse
list), the `--chrome-divider` between them, and each column's flex/overflow behaviour. Its consumers
are the Rollbar, Linear, API and Database panes plus the Editor, Notes, Agents and Changes task
panes, and Rollbar's occurrence workbench nests one inside another; before it existed those eight had
eight column widths and two different border roles, which is why they read as variations on a pane
rather than the same pane.

**The list column is flat — no tint.** The four task panes each gave it `--bg-subtle` and the four
rail/frame panes did not, so the split read differently depending on which rail you reached it from.
One surface divided by a rule, not two shaded regions. There is no opt-out prop, because a per-pane
choice is the thing this replaced.

A list column that can be collapsed passes `list={undefined}` rather than hiding a column that is
still in the grid — `ListDetail` then has one track instead of a zero-width first one. Notes' library
toggle works this way.

It is deliberately not the layout for two separate surfaces. Docker's browse and the GitHub PR pane
are `.panes` + `.pane` from `styles/shell.css` — inset surfaces with a gap between them, and in the
PR pane's case a `SplitHandle` that makes the divide draggable. That layout stays the shell's. The
test is whether the two columns are one surface split by a divider or two surfaces side by side.

**A Source with fewer than three columns spans the shell grid; it never redefines it.** `grid-column:
2 / -1` on the last pane is how GitHub's empty state, the editor pane and Docker's browse all say it.
A plugin that writes its own `grid-template-columns` for `.panes` gets a column width that only
resembles the shell's — Docker's was `clamp(320px, 30vw, 460px)` against the shell's
`clamp(320px, 28vw, 420px)` — and a rule that has to out-specify every style pack's own
`.app.left-collapsed .panes`. Spanning has neither problem and needs no CSS at all.

`ListDetail` sets no narrow-width behaviour. Stacking the columns needs a container query rather
than a media query, and `container-type` would make the element a containing block for
`position: fixed` descendants, which silently mispositions any `Modal` rendered inside it. A pane
that wants to stack declares it on its own class.

## Interaction rules

- Command palette opens with `⌘K` and uses contributed actions and rows.
- `⌘1`–`⌘9` activates the corresponding visible task.
- `⌘⇧T` toggles the terminal drawer; `⌘⇧N` creates a task; `⌘P` opens the file finder.
- Pane chords are contribution-owned and user-overridable through Settings → Shortcuts.
- Typing fields, editors, terminals, and contenteditable elements stop global shortcuts unless the
  action is explicitly text-safe.
- Destructive actions and approvals use shell-owned confirmation chrome.

### Menus and right-click

There is one menu. `ui/Menu.tsx` owns the surface — `role="menu"`/`menuitem`, arrow-key roving with
Home/End, close-on-select, Escape, outside-click, and focus returning to where it came from — and both
ways of opening it mount that same surface (`MenuSurface`) over the same hook (`ui/anchor.ts`). A
button anchors it to a rect; a right-click anchors it to a point, which is the only difference. A
right-click menu with its own markup would be a second place for the accessibility to be wrong.

**Right-click is never the only door.** The rows come from the context-menu registry
(`registries/contextMenus.ts`), and the button menu on the same row renders the identical list, so
nothing is mouse-only. It is also keyboard-reachable directly: `contextmenu` is what the platform
dispatches for Shift+F10 and the menu key as well as for the right button, and the surface focuses its
first item on mount, so the menu is operable the moment it appears rather than something to Tab into.
Point-anchored menus clamp to the viewport rather than flipping — the pointer really can be a pixel
from the bottom edge, and there is no trigger rect to fall back to.

A contribution is a label, an optional icon, an order, a predicate over the host-defined target, and
one action. Core's own rows fit that shape — the tab rail's Pin/Unpin/Rename/Archive are registrations,
not inline JSX — which is what makes the contract real before a plugin uses it. Plugins declare the
same thing from a manifest (`docs/plugins.md § Context menus`); the host binds the owner into the id
and evaluates the declared predicate itself.

## States

Every Node-backed surface can show live, refreshing, stale, offline, disabled, or error. Stale data
retains its last value and names the Node. Offline mutations fail fast and keep typed input. Empty
states explain whether a feature is unconfigured, provider-gated, disabled, or simply has no data.

## Accessibility and density

Focus rings, keyboard traversal, text labels, tooltip delays, and reduced-motion tokens are shared by
client-core primitives. Dense layouts must preserve readable line height and a visible focus target;
style packs may compress spacing but must not hide status or action affordances.
