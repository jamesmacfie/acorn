import { sourceRegistry } from '../registries/sources'

export type TaskOriginAppearance = { glyph: string; tooltip?: string }

const BUILT_IN: Readonly<Record<string, string>> = {
  'github-pr': 'git-pull-request',
  local: 'circle-dot',
}

// Tasks outlive optional plugins. A missing origin contribution therefore degrades to local chrome
// while retaining the opaque origin as explanatory tooltip text.
export function taskOriginAppearance(origin: string): TaskOriginAppearance {
  const builtIn = BUILT_IN[origin]
  if (builtIn) return { glyph: builtIn }
  const source = sourceRegistry.get(origin)
  if (source) return { glyph: source.glyph }
  return { glyph: 'circle-dot', tooltip: origin }
}
