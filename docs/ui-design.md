# UI design

acorn's visual language is deliberately minimal and information-dense: a flat, monospaced, three-pane shell where every pixel of chrome earns its place. There are no shadows except on floating popovers, no gradients, no rounded panes — just 1px dividers, square panes, and a small set of muted greys with two semantic accents (green for additions, red for deletions). The aim is a tool that disappears so the review can foreground.

The SPA imports `apps/web/src/client/styles.css` at boot. That file is now a manifest of feature-owned stylesheets under `apps/web/src/client/styles/`:

- `tokens-layout.css` — design tokens, reset, shell grid, pane containment.
- `pull-list.css` — PR tabs, filters, and virtualized list rows.
- `pull-detail.css` — navigator pane, labels, files, checks, and conversation cards.
- `diff.css` — diff toolbar, virtualized rows, split mode, composers, and thread rows.
- `topbar.css` — collapse toggle, repo picker, account menu, and auth controls.
- `overlays.css` — keyboard shortcuts and file finder overlays.

Vite still emits one client CSS asset, so the split changes ownership and reviewability without adding render-blocking files.

## Principles

- **Monospace everywhere.** The entire UI — not just code — is set in the mono stack, reinforcing the terminal-adjacent, tabular feel and keeping line numbers and stats aligned.
- **Flat and bordered.** Structure is communicated with 1px borders (`--border`), not elevation. Panes are square (`border-radius` is reserved for inputs and pills only).
- **Dense rows.** Lists are fixed-height rows (`--row-h`) so a long PR list or file list stays scannable and virtualizes cleanly.
- **Token-driven theming.** Every colour references a custom property, so switching light/dark is a single attribute flip on `<html>` (see [frontend](./frontend.md) for the toggle).
- **Never colour alone.** Diff add/delete state is always carried by a marker glyph and a background, not hue by itself.

## Design tokens

All tokens are CSS custom properties on `:root`. Light is the default; dark applies via `prefers-color-scheme` (unless the user has forced light) and via `[data-theme="dark"]` (a manual toggle, which wins over the media query).

### Colour — light (`:root`)

| Token | Value | Role |
| --- | --- | --- |
| `--bg` | `#ffffff` | Page / pane background |
| `--bg-subtle` | `#fafafa` | Section summaries, code blocks, secondary surfaces |
| `--bg-hover` | `#f6f6f6` | Hover background |
| `--bg-selected` | `#eeeeee` | Active row / selected state |
| `--border` | `#e2e2e2` | 1px dividers |
| `--border-strong` | `#c9c9c9` | Input / button borders |
| `--text` | `#242424` | Primary text |
| `--text-muted` | `#747474` | Secondary text, metadata |
| `--text-faint` | `#a8a8a8` | Gutters, separators, placeholders |
| `--accent` | `#242424` | Active markers, emphasis |
| `--focus` | `#242424` | Focus-ring colour |
| `--add-bg` / `--add-marker` | `#e9f7ee` / `#1a7f37` | Diff insert line / marker |
| `--del-bg` / `--del-marker` | `#fceef0` / `#cf222e` | Diff delete line / marker |
| `--add-word-bg` / `--del-word-bg` | `#aceebb` / `#f5b7bd` | Word-level intra-line diff spans |
| `--hunk-bg` / `--hunk-text` | `#eef4fb` / `#57606a` | Hunk header band |
| `--warn` | `#9a6700` | Draft badges, pending checks, pins |
| `--badge-border` | `#d4d4d4` | Pill / badge borders |
| `--shadow-popover` | `rgba(0,0,0,0.12)` | Popover / overlay shadow |

### Colour — dark (`[data-theme="dark"]` and `prefers-color-scheme: dark`)

| Token | Value |
| --- | --- |
| `--bg` / `--bg-subtle` / `--bg-hover` / `--bg-selected` | `#121212` / `#1a1a1a` / `#202020` / `#262626` |
| `--border` / `--border-strong` | `#2a2a2a` / `#424242` |
| `--text` / `--text-muted` / `--text-faint` | `#dddddd` / `#8d8d8d` / `#5d5d5d` |
| `--accent` / `--focus` | `#dddddd` / `#dddddd` |
| `--add-bg` / `--add-marker` | `#12261b` / `#3fb950` |
| `--del-bg` / `--del-marker` | `#2a1416` / `#f85149` |
| `--add-word-bg` / `--del-word-bg` | `#1f6f33` / `#7a2630` |
| `--hunk-bg` / `--hunk-text` | `#161f2b` / `#8b949e` |
| `--warn` / `--badge-border` | `#d29922` / `#383838` |
| `--shadow-popover` | `rgba(0,0,0,0.42)` |

Syntax highlighting follows the same theme split: Shiki emits dual `github-light` / `github-dark` colours onto `--l` / `--r` per token, and CSS selects `--l` in light mode, `--r` in dark (see [diff-rendering](./diff-rendering.md)).

### Typography

| Token | Value |
| --- | --- |
| `--font-mono` | `"Berkeley Mono", ui-monospace, "SF Mono", "JetBrains Mono", "Cascadia Code", Menlo, Consolas, monospace` |
| `--fs-sm` | `12px` (the workhorse size — rows, metadata, most chrome) |
| `--fs` | `13px` (body default) |
| `--fs-lg` | `15px` (PR titles) |
| `--lh` | `1.5` (text) |
| `--lh-diff` | `1.45` (diff text) |

`body` is set in `--font-mono` at `--fs`, with antialiasing and `optimizeLegibility`. Section headers and uppercase labels use `--fs-sm` with `letter-spacing: 0.08em` and `text-transform: uppercase`. Numeric columns (line counts, gutters, timestamps) use `font-variant-numeric: tabular-nums`.

### Spacing, shape, motion

| Token | Value | Use |
| --- | --- | --- |
| `--radius` | `4px` | Inputs and pills only — panes and rows stay square |
| `--pane-pad` | `14px` | Horizontal padding inside panes / headers |
| `--row-h` | `36px` | Fixed list-row height (PR rows, file rows, check rows) |
| `--topbar-h` | `48px` | Top-bar height |
| `--pane-head-h` | `48px` | Sticky section-header height |
| `--ease-out` | `cubic-bezier(0.16, 1, 0.3, 1)` | Transition easing |
| `--dur-short` | `150ms` | Hover/focus colour transitions |

Pills (state badges, labels) use `border-radius: 999px`; everything structural is square. Motion is limited to short colour/border transitions on interactive elements — there are no layout animations.

## Three-pane layout

`.app` is a CSS grid of `var(--topbar-h) 1fr`: the top bar over `.panes`. `.panes` is a three-column grid:

```
grid-template-columns:
  var(--left, clamp(320px, 28vw, 420px))   /* left   — Reviews    */
  clamp(360px, 23vw, 430px)                /* mid    — Navigator  */
  minmax(0, 1fr);                          /* right  — Diff       */
```

Each `.pane` scrolls independently (`overflow: auto`), is separated by a 1px right border (the right pane drops it), and sets `contain: layout paint` so a reflow in one pane cannot ripple into the others. The left pane is a flex column so its PR list scrolls/virtualizes independently of the tabs above it; the right pane is a flex column so the diff scroller owns the viewport.

Collapsing the left pane (a top-bar toggle, persisted via the `left_collapsed` pref) zeroes the left grid column and sets the pane to `display: none`, leaving no stray border.

The top bar is a `1fr auto 1fr` grid: a left cluster (collapse toggle + repo picker), a centered breadcrumb / brand, and a right cluster (theme toggle + account control). See [frontend](./frontend.md) for the components that fill it.

## Surfaces and accents

- **Section headers** are sticky, uppercase, muted, `--pane-head-h` tall, with a bottom border.
- **Active rows** (selected PR, selected file) get `--bg-selected` plus a 3px left border in `--accent`; hover uses `--bg-hover`.
- **Floating surfaces** — the repo picker popover, account menu, and keyboard overlays — are the only elements with elevation, using `box-shadow` with `--shadow-popover` over a `--border-strong` outline.
- **Diff lines** colour by state: insert rows take `--add-bg` with a green `+` marker, delete rows `--del-bg` with a red `−`; word-level changes layer the stronger `--*-word-bg` over the line. Hunk headers sit on `--hunk-bg`.
- **Status semantics** reuse the diff palette: open PR state and passing checks use `--add-marker`, closed/failing use `--del-marker`, pending/draft use `--warn`.
