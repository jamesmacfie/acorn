import { sourceRegistry } from '../../host/registries/sources/sources'

export type TaskOriginAppearance = { glyph: string; tooltip?: string }

// Tasks outlive optional plugins. A missing origin contribution therefore degrades to local chrome
// while retaining the opaque origin as explanatory tooltip text. `local` is core's own origin and is
// the only one named here; every other origin belongs to the source that makes tasks with it.
export function taskOriginAppearance(origin: string): TaskOriginAppearance {
  if (origin === 'local') return { glyph: 'circle-dot' }
  for (const source of sourceRegistry.entries()) {
    const glyph = source.origins?.[origin]
    if (glyph) return { glyph }
  }
  const source = sourceRegistry.get(origin)
  if (source) return { glyph: source.glyph }
  return { glyph: 'circle-dot', tooltip: origin }
}
