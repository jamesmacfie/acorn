import { Registry } from '../../../kit/lib/state/registry'

export type ThemeContribution = { id: string; label: string }
export const themeRegistry = new Registry<ThemeContribution>('theme')
export const themeContributions = (): readonly ThemeContribution[] => themeRegistry.entries()
