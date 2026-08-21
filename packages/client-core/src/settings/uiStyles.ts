import { styleContributions, styleRegistry, type StyleContribution } from '../registries/styles'

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
