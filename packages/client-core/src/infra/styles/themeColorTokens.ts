import palettes from './themeCellTokens.json'

/** Built-in theme primitives needed by cell hosts, generated from the desktop theme stylesheet. */
export function themeColorTokens(id: string): Readonly<Record<string, string>> | null {
  const palette = (palettes as Record<string, Record<string, string>>)[id]
  if (!palette) return null
  return {
    ...palette,
    '--state-ok': palette['--add-marker'],
    '--state-warn': palette['--warn'],
    '--state-bad': palette['--del-marker'],
  }
}
