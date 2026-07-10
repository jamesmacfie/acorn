import { Registry } from './registry'

export type ThemeContribution = { id: string; label: string }
export const themeRegistry = new Registry<ThemeContribution>('theme')
export const themeContributions = (): readonly ThemeContribution[] => themeRegistry.entries()
