// Terminal marks for shared Icon names. The product chooses a semantic name and tone; this host
// chooses one cell of text. Keep the table small and explicit so an added Lucide name cannot quietly
// turn into a word in a narrow row. Names without a terminal mark draw nothing.
const GLYPHS: Record<string, string> = {
  'archive': '▣',
  'circle': '○',
  'circle-alert': '!',
  'circle-check': '✓',
  'circle-dashed': '◌',
  'circle-question-mark': '?',
  'circle-stop': '■',
  'clipboard-pen': '✎',
  'clock': '◷',
  'list-plus': '+',
  'loader-circle': '⠋',
  'shield-question-mark': '?',
  'triangle-alert': '⚠',
  'workflow': '◇',
}

// One shell-owned tick drives both Spinner and spinning Icon instances. A render without a running
// shell stays on frame zero, which also makes cell tests deterministic.
const SPINNER = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'

export const spinnerGlyph = (frame: number): string => SPINNER[frame % SPINNER.length]!

export function iconGlyph(name: string): string | null {
  const mapped = GLYPHS[name]
  return typeof mapped === 'string' ? mapped : null
}
