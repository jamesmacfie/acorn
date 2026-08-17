// The appearance token contract, as data. Appearance is two orthogonal axes on <html>:
// `data-theme` owns colour, `data-style` owns shape/typography/space/density/chrome/motion. The
// two token sets are disjoint, which is what lets them compose without either winning on
// specificity or source order.
//
// This module is the single declaration of which token belongs to which axis.
// `styles/tokenAxes.test.ts` reads the stylesheets and asserts they agree, so the contract fails
// the suite rather than degrading silently.
import { THEME_PALETTE_TOKENS } from '@acorn/protocol/themeTokens.ts'

/** Theme self-description: what a theme says ABOUT itself, and the only theme tokens that are not
 * colours. Dark themes flip all three. A plugin theme cannot spell them — the host writes them from
 * that theme's `dark` flag (`plugins/chrome/themes.ts`). */
export const SELF_DESCRIPTION_TOKENS = ['--is-dark', '--color-scheme', '--syntax-fg'] as const

/** Declared ONCE on `:root` as `var()` references into the palette, so they follow every theme for
 * free — which is exactly why a theme block must never restate one. */
export const DERIVED_THEME_TOKENS = [
  '--danger', '--danger-fg', '--success', '--success-fg',
  '--surface-sunken', '--accent-fg',
  '--state-ok', '--state-warn', '--state-bad',
  '--find-hit-bg', '--find-current-bg', '--scrim-color',
] as const

/** SERIES IDENTITY, for a chart mark that is asking "which one is this" rather than "how is this
 * doing" (docs/future/dashboards/charts.md § 1). Colour, so theme axis — but neither primitive nor
 * derived, and that is the whole point of the third group:
 *
 *   NOT a primitive: a plugin-contributed theme is validated against `THEME_PALETTE_TOKENS` in full,
 *   so adding these there would reject every theme already in the wild for omitting them. They carry
 *   defaults on `:root` instead, and a pack that wants its own may restate them.
 *
 *   NOT derived: the five status tones are exactly what they must not be, so there is no primitive to
 *   reference. They are real values — ONE set, deliberately not a light/dark pair: the defaults sit
 *   at a lightness that clears 3:1 on both grounds, because a --dark-* flip would only reach the two
 *   default paths and leave every named dark theme on the light values (tokens-theme.css § SERIES
 *   IDENTITY has the full argument).
 *
 * Three, hard cap. Series four onwards folds into `other`, which is `--text-faint`. */
export const SERIES_TOKENS = ['--viz-series-1', '--viz-series-2', '--viz-series-3'] as const

/** Colour, and only colour. Restated per theme in `styles/tokens-theme.css`.
 *
 * The palette half lives in `@acorn/protocol/themeTokens.ts` because it is also the manifest contract
 * for a plugin-contributed theme and the node has to validate one without importing the client. Which
 * tokens belong to which AXIS is still decided here, by this list. */
export const THEME_TOKENS = [
  ...THEME_PALETTE_TOKENS,
  ...SELF_DESCRIPTION_TOKENS,
  ...DERIVED_THEME_TOKENS,
  ...SERIES_TOKENS,
] as const

/** Shape, typography, space, density, chrome, motion. Defaults in `styles/tokens-style.css`. */
export const STYLE_TOKENS = [
  // shape
  '--radius-0', '--radius-xs', '--radius-sm', '--radius-md', '--radius-lg', '--radius-xl',
  '--radius-pill', '--radius-circle',
  '--radius-control', '--radius-surface', '--radius-popover', '--radius-chip',
  '--radius-pill-fixed', '--radius-marker', '--radius',
  '--bw-0', '--bw', '--bw-strong', '--bw-marker',
  '--divider-w', '--chrome-divider-w', '--pane-divider-w', '--pane-bw',
  '--control-bw', '--surface-bw', '--marker-w', '--stripe-w', '--tab-active-w',
  '--divider', '--chrome-divider', '--control-border', '--surface-border',
  // space
  '--space-0', '--space-1', '--space-2', '--space-3', '--space-4', '--space-5',
  '--space-6', '--space-7', '--space-8', '--space-9', '--space-10', '--space-11',
  '--pane-pad', '--pane-pad-y', '--gap-inline', '--gap-row', '--gap-stack', '--gap-section',
  '--pad-control', '--pad-control-lg', '--pad-chip', '--pad-cell', '--pad-surface', '--pad-body',
  // density
  '--row-h', '--row-h-sm', '--row-h-virt', '--control-h', '--control-h-sm',
  '--topbar-h', '--pane-head-h', '--tabrail-w', '--task-footer-h',
  '--listdetail-w', '--listdetail-w-narrow',
  '--icon-size', '--icon-box', '--avatar-sm', '--avatar-md', '--diff-line-h', '--term-fs',
  // typography
  '--font-mono', '--font-ui', '--font-glyph', '--font-display',
  '--fs-2xs', '--fs-xs', '--fs-sm', '--fs', '--fs-md', '--fs-lg', '--fs-xl',
  '--lh', '--lh-tight', '--lh-diff',
  '--fw-normal', '--fw-medium', '--fw-semibold', '--fw-bold',
  '--label-transform', '--label-tracking', '--label-weight', '--label-size',
  '--heading-transform', '--heading-tracking', '--heading-weight',
  // elevation
  '--shadow-0', '--shadow-1', '--shadow-2', '--shadow-3', '--shadow-4', '--shadow-5',
  '--shadow-drawer-l', '--shadow-drawer-l-sm',
  '--elev-popover', '--elev-menu', '--elev-modal', '--elev-drawer', '--elev-panel',
  '--elev-card', '--elev-pane', '--elev-row-hover',
  '--ring', '--focus-ring-w', '--focus-ring-offset', '--focus-ring-style',
  '--scrim-alpha', '--scrim', '--scrim-filter',
  '--card-bg', '--pane-bg', '--popover-bg', '--input-bg', '--chip-bg',
  '--shell-pad', '--pane-gap', '--pane-radius',
  // motion
  '--dur-instant', '--dur-short', '--dur-med', '--dur-long',
  '--ease-out', '--ease-in-out', '--ease-spring', '--ease-interactive',
  '--transition-color', '--hover-lift', '--press-scale',
] as const

/** Owned by neither axis. Declared in `styles/tokens-invariant.css`. */
export const INVARIANT_TOKENS = [
  '--z-base', '--z-sticky', '--z-resizer', '--z-float', '--z-rail', '--z-panel',
  '--z-popover', '--z-drawer', '--z-drawer-menu', '--z-overlay', '--z-modal',
  '--z-picker', '--z-toast', '--z-tooltip',
  '--brand-github', '--brand-linear', '--brand-rollbar', '--brand-fg',
  '--tabular',
] as const

// Tokens read from JavaScript via getComputedStyle, because canvas surfaces cannot use CSS:
// xterm (plugins/terminal/client/theme.ts, plugins/docker/client/DockerExecTerminal.tsx) and
// Monaco (plugins/editor/client/EditorPane.tsx).
//
// Renaming one of these breaks the terminal and the editor with NO type error and NO test failure
// — the bridges look them up by string. Declaring the coupling here makes it visible to a reader
// and checkable by the test. Add to this list when a bridge starts reading a new token.
export const BRIDGE_TOKENS = [
  '--bg', '--bg-subtle', '--bg-hover', '--bg-selected',
  '--text', '--text-muted', '--text-faint',
  '--font-mono', '--is-dark', '--term-fs',
] as const

/** Complete CSS-variable projection for isolated plugin documents. Unlike BRIDGE_TOKENS, which is
 * the small canvas/JavaScript contract, frames render the shared CSS itself and therefore need every
 * token from both appearance axes plus the invariant stacking/brand values. */
export const FRAME_TOKENS = [
  ...THEME_TOKENS,
  ...STYLE_TOKENS,
  ...INVARIANT_TOKENS,
] as const

/** Ordering constraints that are behavioural, not cosmetic. Asserted by the test. */
export const Z_ORDER_INVARIANTS: readonly (readonly [above: string, below: string])[] = [
  // A Picker opened inside a modal is portalled to <body>, making it a sibling of the backdrop
  // rather than a descendant; without this it renders behind the modal it belongs to.
  ['--z-picker', '--z-modal'],
  ['--z-modal', '--z-overlay'],
  ['--z-drawer-menu', '--z-drawer'],
  // A toast is how the app says "that worked". Occluded by the modal the action was taken in, it
  // says nothing at all.
  ['--z-toast', '--z-modal'],
  ['--z-tooltip', '--z-toast'],
]
