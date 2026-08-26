// Project colour is a small wire contract shared by the Node validation boundary and the renderer.
// Stored values are either a stable preset key or a six-digit hex colour. A null/invalid value has
// no accent; the normal active-tab accent still comes from the application theme.

export const PROJECT_COLORS = {
  green: '#1a7f37',
  blue: '#0969da',
  purple: '#8250df',
  orange: '#bc4c00',
  red: '#cf222e',
  teal: '#1b7c83',
  magenta: '#bf3989',
  gray: '#57606a',
} as const

export function resolveProjectColor(color: string | null | undefined): string | null {
  if (!color) return null
  const preset = PROJECT_COLORS[color as keyof typeof PROJECT_COLORS]
  if (preset) return preset
  const hex = color.startsWith('#') ? color.slice(1) : color
  return /^[0-9a-fA-F]{6}$/.test(hex) ? `#${hex}` : null
}

export const isValidProjectColor = (color: string): boolean =>
  color in PROJECT_COLORS || /^#?[0-9a-fA-F]{6}$/.test(color)
