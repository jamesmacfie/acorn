import { Registry } from './registry'

// Visual styles (shape, typography, space, density, chrome, motion) — the second appearance axis,
// orthogonal to themes, which own colour. Mirrors registries/themes.ts so a plugin can contribute
// a style pack the same way it would contribute a theme.
export type StyleContribution = { id: string; label: string; description?: string }
export const styleRegistry = new Registry<StyleContribution>('style')
export const styleContributions = (): readonly StyleContribution[] => styleRegistry.entries()
