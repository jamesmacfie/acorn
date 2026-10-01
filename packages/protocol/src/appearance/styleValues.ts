// The style axis is data, never a plugin stylesheet. The manifest parser and the shell use this
// same alphabet before a value can enter a generated CSS declaration.
export type StyleTokenFamily =
  | 'length' | 'radius' | 'space' | 'font' | 'fontSize' | 'lineHeight' | 'weight'
  | 'transform' | 'tracking' | 'shadow' | 'elevation' | 'border' | 'borderStyle'
  | 'themeColor' | 'alpha' | 'duration' | 'easing' | 'transition' | 'filter' | 'motion'

const families = {
  radius: '--radius-0 --radius-xs --radius-sm --radius-md --radius-lg --radius-xl --radius-pill --radius-circle --radius-control --radius-surface --radius-popover --radius-chip --radius-pill-fixed --radius-marker --radius --pane-radius',
  length: '--bw-0 --bw --bw-strong --bw-marker --divider-w --chrome-divider-w --pane-divider-w --pane-bw --control-bw --surface-bw --marker-w --stripe-w --tab-active-w --pane-measure --page-measure --row-h --row-h-sm --row-h-virt --control-h --control-h-sm --control-h-xs --topbar-h --pane-head-h --tab-h --tabrail-w --task-footer-h --listdetail-w --listdetail-w-narrow --listdetail-w-wide --setting-control-w --icon-size --icon-box --avatar-sm --avatar-md --diff-line-h --term-fs --focus-ring-w --focus-ring-offset',
  space: '--space-0 --space-1 --space-2 --space-3 --space-4 --space-5 --space-6 --space-7 --space-8 --space-9 --space-10 --space-11 --pane-pad --pane-pad-y --gap-inline --gap-row --gap-stack --gap-section --pad-control --pad-control-lg --pad-chip --pad-cell --pad-surface --pad-body --shell-pad --pane-gap',
  font: '--font-mono --font-ui --font-glyph --font-display',
  fontSize: '--fs-2xs --fs-xs --fs-sm --fs --fs-md --fs-lg --fs-xl --label-size',
  lineHeight: '--lh --lh-tight --lh-diff',
  weight: '--fw-normal --fw-medium --fw-semibold --fw-bold --label-weight --heading-weight',
  transform: '--label-transform --heading-transform',
  tracking: '--label-tracking --heading-tracking',
  shadow: '--shadow-0 --shadow-1 --shadow-2 --shadow-3 --shadow-4 --shadow-5 --shadow-drawer-l --shadow-drawer-l-sm --ring --ring-highlight',
  elevation: '--elev-popover --elev-menu --elev-modal --elev-drawer --elev-panel --elev-card --elev-pane --elev-row-hover',
  border: '--divider --chrome-divider --control-border --surface-border',
  borderStyle: '--focus-ring-style',
  themeColor: '--card-bg --pane-bg --popover-bg --input-bg --chip-bg --scrim',
  alpha: '--scrim-alpha',
  duration: '--dur-instant --dur-short --dur-med --dur-long',
  easing: '--ease-out --ease-in-out --ease-spring --ease-interactive',
  transition: '--transition-color',
  filter: '--scrim-filter',
  motion: '--hover-lift --press-scale',
} satisfies Record<StyleTokenFamily, string>

export const STYLE_TOKEN_FAMILIES: Readonly<Record<string, StyleTokenFamily>> = Object.fromEntries(
  Object.entries(families).flatMap(([family, tokens]) => tokens.split(' ').map((token) => [token, family])),
) as Record<string, StyleTokenFamily>

// These recipes and role aliases remain host-owned. Packs can set their primitive inputs, and the
// aliases follow through the cascade. In particular a plugin cannot redirect a border to a colour.
export const DERIVED_STYLE_TOKENS = [
  '--radius-control', '--radius-surface', '--radius-popover', '--radius-chip',
  '--radius-pill-fixed', '--radius-marker', '--radius',
  '--divider-w', '--chrome-divider-w', '--pane-divider-w', '--pane-bw', '--control-bw',
  '--surface-bw', '--marker-w', '--stripe-w', '--tab-active-w',
  '--divider', '--chrome-divider', '--control-border', '--surface-border',
  '--pane-pad', '--pane-pad-y', '--gap-inline', '--gap-row', '--gap-stack', '--gap-section',
  '--pad-control', '--pad-control-lg', '--pad-chip', '--pad-cell', '--pad-surface', '--pad-body',
  '--tabrail-w', '--font-ui', '--font-glyph', '--font-display',
  '--label-weight', '--label-size', '--heading-weight',
  '--elev-popover', '--elev-menu', '--elev-modal', '--elev-drawer', '--elev-panel',
  '--elev-card', '--elev-pane', '--elev-row-hover', '--ring', '--ring-highlight', '--scrim',
  '--card-bg', '--pane-bg', '--popover-bg', '--input-bg', '--chip-bg',
  '--pane-radius', '--ease-interactive', '--transition-color',
] as const

const derived = new Set<string>(DERIVED_STYLE_TOKENS)
const scalarLength = '(?:0|(?:-?(?:\\d+|\\d*\\.\\d+))(?:px|rem|em|vw|vh|%))'
const length = new RegExp(`^${scalarLength}$`)
const lengths = new RegExp(`^${scalarLength}(?: ${scalarLength}){1,3}$`)
const clamp = new RegExp(`^clamp\\(${scalarLength}, ${scalarLength}, ${scalarLength}\\)$`)
const font = /^(?:"[A-Za-z0-9 -]+"|'[A-Za-z0-9 -]+'|[A-Za-z][A-Za-z0-9 -]*)(?:, (?:"[A-Za-z0-9 -]+"|'[A-Za-z0-9 -]+'|[A-Za-z][A-Za-z0-9 -]*))*$/
const shadow = new RegExp(`^(?:inset )?${scalarLength}(?: ${scalarLength}){2,3} var\\(--shadow-popover\\)$`)

export const styleValueAlphabet: Readonly<Record<StyleTokenFamily, (value: string) => boolean>> = {
  length: (v) => length.test(v) || clamp.test(v),
  radius: (v) => length.test(v),
  space: (v) => length.test(v) || lengths.test(v),
  font: (v) => font.test(v) && !/\b(?:url|expression)\b/i.test(v),
  fontSize: (v) => length.test(v),
  lineHeight: (v) => /^(?:0|[0-9]+(?:\.[0-9]+)?)$/.test(v),
  weight: (v) => /^(?:[1-9]00)$/.test(v),
  transform: (v) => /^(?:none|uppercase|lowercase|capitalize)$/.test(v),
  tracking: (v) => length.test(v),
  shadow: (v) => v === 'none' || shadow.test(v),
  elevation: () => false,
  border: () => false,
  borderStyle: (v) => /^(?:none|solid|dashed|dotted)$/.test(v),
  themeColor: () => false,
  alpha: (v) => /^(?:0(?:\.\d+)?|1(?:\.0+)?)$/.test(v),
  duration: (v) => /^(?:0|\d+(?:\.\d+)?(?:ms|s))$/.test(v),
  easing: (v) => /^(?:linear|ease|ease-in|ease-out|ease-in-out|cubic-bezier\((?:-?\d+(?:\.\d+)?, ){3}-?\d+(?:\.\d+)?\))$/.test(v),
  transition: () => false,
  filter: (v) => v === 'none' || /^blur\(\d+(?:\.\d+)?px\)$/.test(v),
  motion: (v) => v === 'none' || /^translateY\(-?\d+(?:\.\d+)?px\)$/.test(v) || /^scale\(0?\.\d+\)$/.test(v),
}

export function styleValueProblem(token: string, value: unknown): string | null {
  const family = STYLE_TOKEN_FAMILIES[token]
  if (!family) return `unknown style token ${token}`
  if (derived.has(token)) return `${token} is host-derived`
  if (typeof value !== 'string' || value.length > 160 || value.trim() !== value || !styleValueAlphabet[family](value)) {
    return `${token} requires a ${family} value`
  }
  if (token === '--font-mono' && !/\bmonospace$/.test(value)) return '--font-mono must end in monospace'
  return null
}
