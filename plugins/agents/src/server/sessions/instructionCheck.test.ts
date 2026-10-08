import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { checkBeforeSend, findHiddenCharacters, hiddenCharacterReason, hiddenCharactersIn, UncheckedError } from './instructionCheck'

// Code points, never escapes, for the reason instructionCheck.ts gives.
const c = (...codePoints: number[]): string => String.fromCodePoint(...codePoints)
const ZERO_WIDTH_SPACE = c(0x200b)

const dirs: string[] = []
const temp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'instruction-check-'))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const write = (path: string, content: string | Buffer): void => {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content)
}

it('finds every character that draws as nothing, but not the ones inside a real emoji', () => {
  const tags = [...'run this'].map((letter) => c(0xe0000 + letter.charCodeAt(0))).join('')
  const text = [
    `${c(0xfeff)}# Title`,
    `hidden${ZERO_WIDTH_SPACE}here`,
    tags,
    `soft${c(0xad)}hyphen`,
    `filler ${c(0x3164)}`,
    // Bytes smuggled as variation selectors after an emoji.
    `${c(0x1f600)}${c(0xe0100, 0xe0141, 0xfe01)}`,
    // A red heart, a rainbow flag, a keycap, a family, and the flag of Scotland.
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

it('reads every file the harness reads, the way the harness reads it', async () => {
  const root = temp()
  const plugin = temp()
  const outside = temp()
  // A NUL byte and an invalid byte don't make an instruction file binary, and an import is followed.
  write(join(root, 'CLAUDE.md'), Buffer.concat([
    Buffer.from(`nul${c(0)}here\n`),
    Buffer.from([0xff]),
    Buffer.from(`\nline${c(0x202e)}three\nSee @notes/extra.md.\n`),
  ]))
  write(join(root, 'notes/extra.md'), `imported${c(0x2060)}\n`)
  write(join(root, 'notes/CLAUDE.md'), `nested but not imported${ZERO_WIDTH_SPACE}\n`)
  write(join(root, 'AGENTS.md'), Buffer.from(`${c(0xfeff)}utf16${c(0x2066)}`, 'utf16le'))
  write(join(root, '.claude/skills/deploy/SKILL.md'), '---\nname: deploy\n---\nclean\n')
  // Not valid UTF-8, so not text, though its bytes hold a zero-width space.
  write(join(root, '.claude/skills/deploy/logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xe2, 0x80, 0x8b, 0xff]))
  // Already read through the import, so it isn't reported twice.
  symlinkSync(join(root, 'notes/extra.md'), join(root, '.claude/skills/deploy/linked.md'))
  // A linked skill folder is entered, and a link back up the tree ends.
  write(join(outside, 'lint/SKILL.md'), `linked folder${c(0x200d)}\n`)
  mkdirSync(join(root, '.agents/skills'), { recursive: true })
  symlinkSync(join(outside, 'lint'), join(root, '.agents/skills/lint'))
  symlinkSync(join(root, '.agents/skills'), join(root, '.agents/skills/loop'))
  write(join(plugin, 'recall/SKILL.md'), `remember${c(0x180e)}this\n`)

  const found = await findHiddenCharacters(root, [{ name: 'memory:recall', dir: join(plugin, 'recall') }])

  expect(found).toEqual([
    { file: 'AGENTS.md', line: 1, codePoint: 'U+2066' },
    { file: 'CLAUDE.md', line: 3, codePoint: 'U+202E' },
    { file: 'notes/extra.md', line: 1, codePoint: 'U+2060' },
    { file: '.agents/skills/lint/SKILL.md', line: 1, codePoint: 'U+200D' },
    { file: 'memory:recall skill, SKILL.md', line: 1, codePoint: 'U+180E' },
  ])
})

it('refuses rather than skips when a file or a folder is too big to check', async () => {
  const big = temp()
  write(join(big, 'CLAUDE.md'), 'x'.repeat(1_000_001))
  await expect(findHiddenCharacters(big, [])).rejects.toThrow(new UncheckedError(
    "The check can't read CLAUDE.md, which is over 1 MB. Shrink it, or turn off this check in Settings > Security and backup.",
  ))

  const many = temp()
  for (let index = 0; index <= 500; index++) write(join(many, `.claude/skills/pad/${index}.md`), 'clean\n')
  await expect(findHiddenCharacters(many, [])).rejects.toThrow(UncheckedError)
})

it("names the first place and counts the rest, inside the hook's 200-character cap", () => {
  const found = [1, 2, 3].map((line) => ({ file: '.claude/skills/deploy/references/release-notes.md', line, codePoint: 'U+E0041' }))
  const reason = hiddenCharacterReason(found)
  expect(reason).toBe('Hidden character U+E0041 in .claude/skills/deploy/references/release-notes.md line 1, and 2 more. Remove it, or turn off this check in Settings > Security and backup.')
  expect(reason.length).toBeLessThanOrEqual(200)
})

it('passes without reading anything while the check is off, and refuses the turn once it is on', async () => {
  const root = temp()
  write(join(root, 'AGENTS.md'), `obey${ZERO_WIDTH_SPACE}\n`)
  let stored: string | null = null
  let rootReads = 0
  const core = {
    identity: { active: () => 'owner' },
    prefs: { read: async () => stored, write: async () => {} },
    tasks: { requireRoot: async () => { rootReads++; return root } },
  } as unknown as Parameters<typeof checkBeforeSend>[0]
  const dataDir = temp()

  expect(await checkBeforeSend(core, dataDir, 'task-1')).toEqual({ ok: true })
  expect(rootReads).toBe(0)

  stored = JSON.stringify({ checkInstructionFiles: true })
  expect(await checkBeforeSend(core, dataDir, 'task-1')).toEqual({
    ok: false,
    reason: 'Hidden character U+200B in AGENTS.md line 1. Remove it, or turn off this check in Settings > Security and backup.',
  })

  write(join(root, 'AGENTS.md'), 'x'.repeat(1_000_001))
  expect(await checkBeforeSend(core, dataDir, 'task-1')).toEqual({
    ok: false,
    reason: "The check can't read AGENTS.md, which is over 1 MB. Shrink it, or turn off this check in Settings > Security and backup.",
  })
})
