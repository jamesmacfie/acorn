export const TERMINAL_FONT_SIZE_OPTIONS = [13, 15, 17, 19, 21] as const
export const TERMINAL_FONT_SIZE_MIN = 11
export const TERMINAL_FONT_SIZE_MAX = 24
export const TERMINAL_LINE_HEIGHT = 1.15

/** Normalize the persisted string without letting a corrupt preference break xterm measurement. */
export function resolveTerminalFontSize(raw: string | undefined, fallback: number): number {
  const value = Number(raw)
  return Number.isInteger(value) && value >= TERMINAL_FONT_SIZE_MIN && value <= TERMINAL_FONT_SIZE_MAX
    ? value
    : fallback
}
