import { expect, it } from 'vitest'
import { hiddenCharacterReason, hiddenCharactersIn } from './instructionCheck'

// Use code points rather than escapes so a writing tool cannot plant hidden text here.
const c = (...codePoints: number[]): string => String.fromCodePoint(...codePoints)

it('finds hidden characters outside real emoji, including payloads after an emoji', () => {
  const tags = [...'run this'].map((letter) => c(0xe0000 + letter.charCodeAt(0))).join('')
  const text = [
    `${c(0xfeff)}# Title`,
    `hidden${c(0x200b)}here`,
    tags,
    `soft${c(0xad)}hyphen`,
    `filler ${c(0x3164)}`,
    `${c(0x1f600)}${c(0xe0100, 0xe0141, 0xfe01)}`,
    `${c(0x2764, 0xfe0f)} ${c(0x1f3f3, 0xfe0f, 0x200d, 0x1f308)} ${c(0x31, 0xfe0f, 0x20e3)} ${c(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467)} ${c(0x1f3f4, 0xe0067, 0xe0062, 0xe0073, 0xe0063, 0xe0074, 0xe007f)}`,
  ].join('\n')
  expect(hiddenCharactersIn(text, 'AGENTS.md')).toEqual([
    { file: 'AGENTS.md', line: 2, codePoint: 'U+200B' },
    { file: 'AGENTS.md', line: 3, codePoint: 'U+E0072' },
    { file: 'AGENTS.md', line: 4, codePoint: 'U+00AD' },
    { file: 'AGENTS.md', line: 5, codePoint: 'U+3164' },
    { file: 'AGENTS.md', line: 6, codePoint: 'U+E0100' },
  ])
})

it('names the first location and counts the rest', () => {
  const found = [1, 2, 3].map((line) => ({ file: '.claude/skills/deploy/references/release-notes.md', line, codePoint: 'U+E0041' }))
  const reason = hiddenCharacterReason(found)
  expect(reason).toBe('Hidden character U+E0041 in .claude/skills/deploy/references/release-notes.md line 1, and 2 more. Remove it, or turn off this check in Settings > Security and backup.')
  expect(reason.length).toBeLessThanOrEqual(200)
})

it('bounds reports from a file with a hidden character on every line', () => {
  const found = hiddenCharactersIn(`x${c(0x200b)}\n`.repeat(2_100), 'AGENTS.md')
  expect(found).toHaveLength(2_000)
  expect(hiddenCharacterReason(found)).toContain('at least 1999 more')
})
