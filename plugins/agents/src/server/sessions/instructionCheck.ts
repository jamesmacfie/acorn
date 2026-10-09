// Hidden-character rules used by required instruction admission and advisory review.
// Code points are numbers, so an editing tool cannot insert an invisible character here
// by interpreting an escape sequence.

// Emoji can contain default-ignorable characters. Mask complete emoji before checking
// so a legitimate emoji is not reported, while a character after it still is.
const HIDDEN = /\p{Default_Ignorable_Code_Point}/gu
const EMOJI = /\p{RGI_Emoji}/gv
const BYTE_ORDER_MARK = 0xfeff
const TURN_OFF = 'or turn off this check in Settings > Security and backup.'
const MAX_HIDDEN_FINDINGS = 2_000

export type HiddenCharacter = { file: string; line: number; codePoint: string }

/** The first hidden character on each line of text, reported against its file. */
export function hiddenCharactersIn(text: string, file: string, limit = MAX_HIDDEN_FINDINGS): HiddenCharacter[] {
  const maximum = Math.max(1, Math.min(limit, MAX_HIDDEN_FINDINGS + 1))
  const masked = text.replace(EMOJI, (emoji) => ' '.repeat(emoji.length))
  const found: HiddenCharacter[] = []
  let line = 1
  let counted = 0
  for (const match of masked.matchAll(HIDDEN)) {
    const codePoint = match[0].codePointAt(0)!
    if (match.index === 0 && codePoint === BYTE_ORDER_MARK) continue
    for (; counted < match.index; counted++) if (masked.charCodeAt(counted) === 10) line++
    if (found.at(-1)?.line === line) continue
    found.push({ file, line, codePoint: `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}` })
    if (found.length === maximum) break
  }
  return found
}

/** A bounded refusal that names the first location and counts the rest. */
export function hiddenCharacterReason(found: readonly HiddenCharacter[]): string {
  const [first] = found
  const more = found.length > 1 ? `, and ${found.length === MAX_HIDDEN_FINDINGS ? 'at least ' : ''}${found.length - 1} more` : ''
  return `Hidden character ${first.codePoint} in ${first.file} line ${first.line}${more}. Remove it, ${TURN_OFF}`
}
