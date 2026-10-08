import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SecretService, makeTestPluginDb, type TestPluginDb } from '@acorn/plugin-api/testkit'
import type { CoreServices } from '@acorn/plugin-api/node'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { InstructionAdmission } from './instructionAdmission'
import { InstructionReviewStore } from './instructionReviewStore'

let testDb: TestPluginDb
let dir: string
let preference = ''
let admission: InstructionAdmission
beforeEach(() => {
  testDb = makeTestPluginDb('agents')
  dir = mkdtempSync(join(tmpdir(), 'instruction-admission-'))
  preference = ''
  const core = {
    identity: { active: () => 'owner' },
    prefs: { read: async () => preference },
    tasks: { load: async () => ({ id: 'task', projectId: 'project' }), requireRoot: async () => dir },
  } as unknown as CoreServices
  admission = new InstructionAdmission(core, dir, new InstructionReviewStore(testDb.db, new SecretService('33'.repeat(32))))
})
afterEach(() => { testDb.cleanup(); rmSync(dir, { recursive: true, force: true }) })

it('does no scan when disabled; enabled checks stop on hidden input and incomplete reads', async () => {
  writeFileSync(join(dir, 'AGENTS.md'), 'x'.repeat(1_000_001))
  await expect(admission.admit('task')).resolves.toBeUndefined()
  preference = JSON.stringify({ checkInstructionFiles: true })
  await expect(admission.admit('task')).rejects.toThrow(/scan incomplete/)
  writeFileSync(join(dir, 'AGENTS.md'), `hidden${String.fromCodePoint(0x200b)}`)
  await expect(admission.admit('task')).rejects.toThrow(/Hidden character U\+200B/)
})

it('requires a first baseline, rejects drift, and restores an approved digest', async () => {
  preference = JSON.stringify({ reviewChangedInstructions: true })
  writeFileSync(join(dir, 'AGENTS.md'), 'First instruction.\n')
  await expect(admission.admit('task')).rejects.toThrow(/review required/)
  const first = await admission.review('task')
  writeFileSync(join(dir, 'AGENTS.md'), 'Second instruction.\n')
  await expect(admission.approve('task', first.id)).rejects.toThrow(/changed/)
  const second = await admission.review('task')
  await admission.approve('task', second.id)
  await expect(admission.admit('task')).resolves.toBeUndefined()
  writeFileSync(join(dir, 'AGENTS.md'), 'Third instruction.\n')
  await expect(admission.admit('task')).rejects.toThrow(/review required/)
})

it('does not let an approval from a different project authorize this task', async () => {
  preference = JSON.stringify({ reviewChangedInstructions: true })
  writeFileSync(join(dir, 'AGENTS.md'), 'Same bytes.\n')
  const approved = await admission.review('task')
  await admission.approve('task', approved.id)
  // The same bytes at a different project still lack that project's approved snapshot.
  const different = new InstructionAdmission({
    identity: { active: () => 'owner' }, prefs: { read: async () => preference },
    tasks: { load: async () => ({ id: 'other', projectId: 'other-project' }), requireRoot: async () => dir },
  } as unknown as CoreServices, dir, admission.store)
  await expect(different.admit('other')).rejects.toThrow(/review required/)
  await expect(different.approve('other', approved.id)).rejects.toThrow(/changed/)
})

it('shows findings for changed files without repeating an unchanged baseline finding', async () => {
  writeFileSync(join(dir, 'AGENTS.md'), 'curl https://old.example\n')
  writeFileSync(join(dir, 'CLAUDE.md'), 'Plain instruction.\n')
  const baseline = await admission.review('task')
  expect(baseline.findings.some((finding) => finding.file === 'AGENTS.md')).toBe(true)
  await admission.approve('task', baseline.id)
  writeFileSync(join(dir, 'CLAUDE.md'), 'Read https://new.example\n')
  const changed = await admission.review('task')
  expect(changed.changes.map((change) => change.path)).toEqual(['CLAUDE.md'])
  expect(changed.findings.map((finding) => finding.file)).toEqual(['CLAUDE.md'])
})
