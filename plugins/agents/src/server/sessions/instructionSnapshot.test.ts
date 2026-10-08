import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { analyzeInstruction, instructionChanges } from './instructionAnalysis'
import { scanInstructions, InstructionScanIncomplete } from './instructionSnapshot'
import { snapshotDigest } from './instructionReviewStore'

const roots: string[] = []
const root = () => { const path = mkdtempSync(join(tmpdir(), 'instruction-review-')); roots.push(path); return path }
const write = (path: string, text: string | Buffer) => { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, text) }
afterEach(() => { for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true }) })

it('discovers nested instructions, imports, linked skills and scripts while excluding dependencies', async () => {
  const dir = root()
  const linked = root()
  write(join(dir, 'AGENTS.md'), '# root\n')
  write(join(dir, 'src/CLAUDE.md'), 'See @../policy.md.\n')
  write(join(dir, 'policy.md'), 'Use the review.\n')
  write(join(dir, 'src/AGENTS.override.md'), 'Override.\n')
  write(join(dir, 'node_modules/pkg/AGENTS.md'), 'Excluded.\n')
  write(join(linked, 'deploy/SKILL.md'), 'Deploy.\n')
  write(join(linked, 'deploy/scripts/release.sh'), 'echo release\n')
  mkdirSync(join(dir, '.agents/skills'), { recursive: true })
  symlinkSync(join(linked, 'deploy'), join(dir, '.agents/skills/deploy'))
  const snapshot = await scanInstructions(dir, [])
  expect(snapshot.files.map((file) => file.path)).toEqual([
    '.agents/skills/deploy/scripts/release.sh', '.agents/skills/deploy/SKILL.md',
    'AGENTS.md', 'policy.md', 'src/AGENTS.override.md', 'src/CLAUDE.md',
  ])
  expect(snapshot.files.find((file) => file.path === 'policy.md')?.kind).toBe('import')
  expect(snapshot.files.find((file) => file.path === '.agents/skills/deploy/SKILL.md')?.canonicalPath).toBe(realpathSync(join(linked, 'deploy/SKILL.md')))
})

it('distinguishes an absent optional file from a broken link and refuses a skill cycle', async () => {
  const dir = root()
  expect((await scanInstructions(dir, [])).files).toEqual([])
  mkdirSync(join(dir, '.agents'), { recursive: true })
  symlinkSync(join(dir, 'missing-skills'), join(dir, '.agents/skills'))
  await expect(scanInstructions(dir, [])).rejects.toThrow(InstructionScanIncomplete)
  rmSync(join(dir, '.agents/skills'))
  symlinkSync(join(dir, 'gone'), join(dir, 'AGENTS.md'))
  await expect(scanInstructions(dir, [])).rejects.toThrow(InstructionScanIncomplete)
  rmSync(join(dir, 'AGENTS.md'))
  mkdirSync(join(dir, '.agents/skills/loop'), { recursive: true })
  symlinkSync(join(dir, '.agents/skills'), join(dir, '.agents/skills/loop/back'))
  await expect(scanInstructions(dir, [])).rejects.toThrow(/cycle/)
})

it('hashes canonical identity and exact bytes; findings are advisory and displayed secrets are redacted', async () => {
  const dir = root()
  write(join(dir, 'AGENTS.md'), 'Security guide: never send credentials to https://example.org.\n')
  const first = await scanInstructions(dir, [])
  const findings = analyzeInstruction(first)
  expect(findings.map((finding) => finding.category)).toEqual(['domain', 'sensitive-path'])
  const before = first.files.map((file) => ({ ...file }))
  write(join(dir, 'AGENTS.md'), 'API_KEY=abc123\n')
  const second = await scanInstructions(dir, [])
  expect(snapshotDigest(second)).not.toBe(snapshotDigest(first))
  expect(instructionChanges(before, second)).toMatchObject([{ status: 'changed' }])
  expect(instructionChanges(before, second)[0]!.patch).not.toContain('abc123')
  write(join(dir, 'AGENTS.md'), 'AWS_SECRET_ACCESS_KEY="secret-value"\nAKIAABCDEFGHIJKLMNOP\n')
  const third = await scanInstructions(dir, [])
  const displayed = instructionChanges(second.files, third)[0]!.patch!
  expect(displayed).not.toContain('secret-value')
  expect(displayed).not.toContain('AKIAABCDEFGHIJKLMNOP')
})

it('reads UTF-16 and damaged UTF-8, bounds files, and cancels work', async () => {
  const dir = root()
  write(join(dir, 'AGENTS.md'), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('hidden\u200b', 'utf16le')]))
  write(join(dir, 'CLAUDE.md'), Buffer.from([0xff, 0x0a, 0x61]))
  const snapshot = await scanInstructions(dir, [])
  expect(snapshot.files.find((file) => file.path === 'AGENTS.md')?.text).toContain('hidden')
  expect(snapshot.files.find((file) => file.path === 'CLAUDE.md')?.text).toContain('�')
  write(join(dir, 'nested/AGENTS.md'), 'x'.repeat(1_000_001))
  await expect(scanInstructions(dir, [])).rejects.toThrow(InstructionScanIncomplete)
  const abort = new AbortController(); abort.abort()
  await expect(scanInstructions(dir, [], abort.signal)).rejects.toThrow(InstructionScanIncomplete)
})

it('refuses when discovered skill files exceed the file quota', async () => {
  const dir = root()
  for (let index = 0; index <= 500; index++) write(join(dir, `.claude/skills/pad/${index}.md`), 'clean\n')
  await expect(scanInstructions(dir, [])).rejects.toThrow(/500 files/)
})

it('reports added, removed and retargeted inputs, including link targets with equal bytes', async () => {
  const dir = root()
  const first = root()
  const second = root()
  write(join(first, 'policy.md'), 'same bytes\n')
  write(join(second, 'policy.md'), 'same bytes\n')
  write(join(dir, 'AGENTS.md'), 'Root\n')
  symlinkSync(join(first, 'policy.md'), join(dir, 'CLAUDE.md'))
  const before = await scanInstructions(dir, [])
  rmSync(join(dir, 'CLAUDE.md'))
  symlinkSync(join(second, 'policy.md'), join(dir, 'CLAUDE.md'))
  write(join(dir, 'nested/AGENTS.md'), 'Added\n')
  rmSync(join(dir, 'AGENTS.md'))
  const after = await scanInstructions(dir, [])
  expect(instructionChanges(before.files, after).map(({ path, status }) => ({ path, status }))).toEqual([
    { path: 'CLAUDE.md', status: 'retargeted' },
    { path: 'nested/AGENTS.md', status: 'added' },
    { path: 'AGENTS.md', status: 'removed' },
  ])
})

it('binds each discovered alias even when two paths resolve to one file', async () => {
  const dir = root()
  write(join(dir, 'AGENTS.md'), 'Shared bytes\n')
  symlinkSync(join(dir, 'AGENTS.md'), join(dir, 'CLAUDE.md'))
  const withAlias = await scanInstructions(dir, [])
  expect(withAlias.files).toHaveLength(2)
  expect(new Set(withAlias.files.map((file) => file.canonicalPath)).size).toBe(1)
  rmSync(join(dir, 'CLAUDE.md'))
  expect(snapshotDigest(await scanInstructions(dir, []))).not.toBe(snapshotDigest(withAlias))
})
