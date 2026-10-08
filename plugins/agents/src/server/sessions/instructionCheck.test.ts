import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { checkBeforeSend, findHiddenCharacters, hiddenCharacterReason, hiddenCharactersIn } from './instructionCheck'

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

it('reports each line once, and ignores a byte order mark at the start of a file', () => {
  const tags = [...'run this'].map((letter) => String.fromCodePoint(0xE0000 + letter.charCodeAt(0))).join('')
  expect(hiddenCharactersIn(`\uFEFF# Title\nplain\nhidden\u200Bhere\n${tags}`, 'AGENTS.md')).toEqual([
    { file: 'AGENTS.md', line: 3, codePoint: 'U+200B' },
    { file: 'AGENTS.md', line: 4, codePoint: 'U+E0072' },
  ])
  expect(hiddenCharactersIn('Plain text with an emoji 🌰 and accents: café.', 'CLAUDE.md')).toEqual([])
})

it('checks the root instruction files and the repo and plugin skill folders, and skips binaries', async () => {
  const root = temp()
  const plugin = temp()
  write(join(root, 'CLAUDE.md'), 'line one\nline\u202Etwo\n')
  write(join(root, 'AGENTS.md'), 'clean\n')
  write(join(root, 'docs/CLAUDE.md'), 'nested\u200B\n')
  write(join(root, '.claude/skills/deploy/SKILL.md'), '---\nname: deploy\n---\nship\u2066it\n')
  write(join(root, '.agents/skills/lint/notes.md'), 'a\u200Db\n')
  write(join(root, '.claude/skills/deploy/logo.png'), Buffer.from([0x89, 0x50, 0x00, 0xE2, 0x80, 0x8B]))
  write(join(plugin, 'recall/SKILL.md'), 'remember\u2060this\n')
  symlinkSync(join(root, 'CLAUDE.md'), join(root, '.claude/skills/deploy/linked.md'))
  mkdirSync(join(root, '.codex/skills'), { recursive: true })
  symlinkSync(root, join(root, '.codex/skills/loop'))

  const found = await findHiddenCharacters(root, [{ name: 'memory:recall', dir: join(plugin, 'recall') }])

  expect(found).toEqual(expect.arrayContaining([
    { file: 'CLAUDE.md', line: 2, codePoint: 'U+202E' },
    { file: '.claude/skills/deploy/SKILL.md', line: 4, codePoint: 'U+2066' },
    { file: '.agents/skills/lint/notes.md', line: 1, codePoint: 'U+200D' },
    { file: 'memory:recall skill, SKILL.md', line: 1, codePoint: 'U+2060' },
    { file: '.claude/skills/deploy/linked.md', line: 2, codePoint: 'U+202E' },
  ]))
  // A linked file is read. Nested instruction files aren't, binaries are skipped, and a linked folder
  // isn't entered.
  expect(found).toHaveLength(5)
})

it("names the first place and counts the rest, inside the hook's 200-character cap", () => {
  const found = [1, 2, 3].map((line) => ({ file: '.claude/skills/deploy/references/release-notes.md', line, codePoint: 'U+E0041' }))
  const reason = hiddenCharacterReason(found)
  expect(reason).toBe('Hidden character U+E0041 in .claude/skills/deploy/references/release-notes.md line 1, and 2 more. Remove it, or turn off this check in Settings > Security and backup.')
  expect(reason.length).toBeLessThanOrEqual(200)
})

it('passes without reading anything while the check is off, and refuses the turn once it is on', async () => {
  const root = temp()
  write(join(root, 'AGENTS.md'), 'obey\u200B\n')
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
})
