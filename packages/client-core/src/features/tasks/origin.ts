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

// A local task with no icon of its own draws the first letter of its title, so two tasks are told
// apart without a hover. Uppercased and letters only, because a lowercase letter or a digit looks like
// a Lucide name: Icon would fetch the full set to check, and "x" would draw the X icon. A title that
// does not start with a letter keeps the origin glyph.
export function localTaskGlyph(title: string): string {
  const letter = title.trim().match(/^\p{L}/u)?.[0]
  return letter ? letter.toLocaleUpperCase() : taskOriginAppearance('local').glyph
}
