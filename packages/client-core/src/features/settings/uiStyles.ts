import { styleContributions, styleRegistry, type StyleContribution } from '../../host/registries/shell/styles'

// Settings → Appearance style picker. 'terminal' is the plain-:root default in
// styles/tokens-style.css and has no [data-style] block, exactly as 'light' has no [data-theme]
// block, which is also why the correct default paints before any JS runs.
const builtInStyles: StyleContribution[] = [
  { id: 'terminal', label: 'Terminal', description: 'Flat, square, monospaced, dense.' },
  { id: 'modern', label: 'Modern', description: 'Sans type, rounded cards, soft elevation.' },
  { id: 'cozy', label: 'Cozy', description: 'Warm serif, roomy spacing, low density.' },
  { id: 'cute', label: 'Cute', description: 'Rounded, playful, springy.' },
]

if (!styleRegistry.entries().length) for (const style of builtInStyles) styleRegistry.register(style)

export const STYLES = (): [string, string][] => styleContributions().map((style) => [style.id, style.label])

/** What is on screen when nothing is stored. Named here rather than spelled at each reader, because the
 *  three that need it — the startup effect, the Appearance page and its palette command — must agree,
 *  and the plain-:root default is this file's fact. */
export const DEFAULT_STYLE = 'terminal'
