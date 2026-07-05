// Workspace identity helpers (docs/next 01): icon JSON parse/serialize and the deterministic
// name-hash default colour. Pure — shared by the Hono routes (parse on read) and the renderer
// (render + settings picker), unit-tested beside this file.
import type { WorkspaceIcon } from './api'

// Preset swatches (flat mid-tone hues that read on both light and dark backgrounds — the app
// palette itself is greyscale, so these are the only chromatic tokens).
export const WORKSPACE_COLORS: Record<string, string> = {
  green: '#1a7f37',
  blue: '#0969da',
  purple: '#8250df',
  orange: '#bc4c00',
  red: '#cf222e',
  teal: '#1b7c83',
  magenta: '#bf3989',
  gray: '#57606a',
}

const COLOR_KEYS = Object.keys(WORKSPACE_COLORS)

// Deterministic default: hash the workspace name onto one of the preset hues, so every workspace
// has a colour before the user ever picks one.
export function defaultWorkspaceColor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return WORKSPACE_COLORS[COLOR_KEYS[h % COLOR_KEYS.length]]
}

// Resolve a stored colour (preset token key or 6-hex, with or without '#') to a CSS colour,
// falling back to the name-hash default.
export function resolveWorkspaceColor(color: string | null | undefined, name: string): string {
  if (color) {
    const preset = WORKSPACE_COLORS[color]
    if (preset) return preset
    const hex = color.startsWith('#') ? color.slice(1) : color
    if (/^[0-9a-fA-F]{6}$/.test(hex)) return `#${hex}`
  }
  return defaultWorkspaceColor(name)
}

// A colour value the PATCH route accepts: preset token or 6-hex.
export const isValidWorkspaceColor = (color: string): boolean =>
  color in WORKSPACE_COLORS || /^#?[0-9a-fA-F]{6}$/.test(color)

// Icon JSON round-trip. Parse is defensive — a malformed DB value degrades to null (derived
// default) rather than throwing into a route.
export function parseWorkspaceIcon(text: string | null | undefined): WorkspaceIcon | null {
  if (!text) return null
  try {
    const v = JSON.parse(text) as Partial<WorkspaceIcon>
    if (v && v.kind === 'github') return { kind: 'github' }
    if (v && (v.kind === 'emoji' || v.kind === 'lucide') && typeof v.value === 'string' && v.value) return { kind: v.kind, value: v.value }
    return null
  } catch {
    return null
  }
}

export const serializeWorkspaceIcon = (icon: WorkspaceIcon): string => JSON.stringify(icon)

// Validate a renderer-supplied icon payload at the route boundary.
export function isValidWorkspaceIcon(v: unknown): v is WorkspaceIcon {
  if (!v || typeof v !== 'object') return false
  const icon = v as Partial<WorkspaceIcon>
  if (icon.kind === 'github') return true
  return (icon.kind === 'emoji' || icon.kind === 'lucide') && typeof icon.value === 'string' && icon.value.length > 0 && icon.value.length <= 64
}
