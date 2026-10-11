import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SecretService, makeTestPluginDb, type TestPluginDb } from '@acorn/plugin-api/testkit'
import type { CoreServices } from '@acorn/plugin-api/node'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { InstructionAdmission } from './instructionAdmission'
import { InstructionReviewStore } from './instructionReviewStore'

let testDb: TestPluginDb
let dir: string
let preference = ''
let admission: InstructionAdmission
const shared = vi.hoisted(() => ({ skills: [] as Array<{ name: string; dir: string }> }))
vi.mock('@acorn/plugin-api/node', () => ({ deliverableSkills: async () => shared.skills }))
beforeEach(() => {
  testDb = makeTestPluginDb('agents')
  dir = mkdtempSync(join(tmpdir(), 'instruction-admission-'))
  preference = ''
  shared.skills = []
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
  expect(admission.latest('project')?.outcome).toBe('incomplete')
  writeFileSync(join(dir, 'AGENTS.md'), `hidden${String.fromCodePoint(0x200b)}`)
  await expect(admission.admit('task')).rejects.toThrow(/Hidden character U\+200B/)
  expect(admission.latest('project')?.outcome).toBe('blocked')
})

it('requires a first baseline, rejects drift, and restores an approved digest', async () => {
  preference = JSON.stringify({ reviewChangedInstructions: true })
  writeFileSync(join(dir, 'AGENTS.md'), 'First instruction.\n')
  await expect(admission.admit('task')).rejects.toThrow(/review required/)
  const first = await admission.review('task')
  writeFileSync(join(dir, 'AGENTS.md'), 'Second instruction.\n')
  await expect(admission.approve('task', first.id!)).rejects.toThrow(/changed/)
  const second = await admission.review('task')
  await admission.approve('task', second.id!)
  await expect(admission.admit('task')).resolves.toBeUndefined()
  expect(admission.latest('project')).toMatchObject({ taskId: 'task', outcome: 'passed' })
  writeFileSync(join(dir, 'AGENTS.md'), 'Third instruction.\n')
  await expect(admission.admit('task')).rejects.toThrow(/review required/)
})

it('recognizes an unchanged approved snapshot without creating another pending approval', async () => {
  preference = JSON.stringify({ reviewChangedInstructions: true })
  writeFileSync(join(dir, 'AGENTS.md'), 'Read the project documentation.\n')
  const baseline = await admission.review('task')
  await admission.approve('task', baseline.id!)
  const save = vi.spyOn(admission.store, 'save')
  const unchanged = await admission.review('task')
  expect(unchanged).toMatchObject({ id: baseline.id, approved: true, baseline: false, changes: [], findings: [] })
  expect(save).not.toHaveBeenCalled()
  await expect(admission.admit('task')).resolves.toBeUndefined()
})

it('still requires approval when the scan scope changes but the file text does not', async () => {
  preference = JSON.stringify({ reviewChangedInstructions: true })
  writeFileSync(join(dir, 'AGENTS.md'), 'Read the project documentation.\n')
  const { snapshot } = await admission.scan('task')
  const older = await admission.store.save('project', { ...snapshot, scope: 'Previous scan coverage' })
  await admission.store.approve(older.id, 'project')
  expect(await admission.review('task')).toMatchObject({ approved: false, baseline: false, changes: [] })
  await expect(admission.admit('task')).rejects.toMatchObject({ code: 'instruction_review_required' })
})

it('requires a separate review for copied project instructions and rejects approving another project\'s review', async () => {
  preference = JSON.stringify({ reviewChangedInstructions: true })
  writeFileSync(join(dir, 'AGENTS.md'), 'Same bytes.\n')
  const approved = await admission.review('task')
  await admission.approve('task', approved.id!)
  const otherRoot = join(dir, 'other-project')
  mkdirSync(otherRoot)
  writeFileSync(join(otherRoot, 'AGENTS.md'), 'Same bytes.\n')
  // Identical text at a different canonical path is a different instruction snapshot.
  const different = new InstructionAdmission({
    identity: { active: () => 'owner' }, prefs: { read: async () => preference },
    tasks: { load: async () => ({ id: 'other', projectId: 'other-project' }), requireRoot: async () => otherRoot },
  } as unknown as CoreServices, dir, admission.store)
  await expect(different.admit('other')).rejects.toThrow(/review required/)
  await expect(different.approve('other', approved.id!)).rejects.toThrow(/changed/)
})

it('reuses exact shared skills across projects, but detects changed skills and additional project instructions', async () => {
  preference = JSON.stringify({ reviewChangedInstructions: true })
  const skillRoot = join(dir, 'shared-skill')
  mkdirSync(skillRoot)
  const skillFile = join(skillRoot, 'SKILL.md')
  writeFileSync(skillFile, 'Read the architecture notes.\n')
  shared.skills = [{ name: 'shared', dir: skillRoot }]
  const project = (id: string) => {
    const root = join(dir, id)
    mkdirSync(root)
    return { root, admission: new InstructionAdmission({
      identity: { active: () => 'owner' }, prefs: { read: async () => preference },
      tasks: { load: async () => ({ id, projectId: id }), requireRoot: async () => root },
    } as unknown as CoreServices, dir, admission.store) }
  }
  const first = project('first'), second = project('second')
  const review = await first.admission.review('first')
  await expect(second.admission.admit('second')).rejects.toMatchObject({ code: 'instruction_review_required' })
  await first.admission.approve('first', review.id!)
  const save = vi.spyOn(admission.store, 'save')
  await expect(second.admission.admit('second')).resolves.toBeUndefined()
  expect(await second.admission.review('second')).toMatchObject({ approved: true, changes: [], findings: [] })
  expect(save).not.toHaveBeenCalled()
  writeFileSync(skillFile, 'Read the updated architecture notes.\n')
  await expect(second.admission.admit('second')).rejects.toMatchObject({ code: 'instruction_review_required' })
  const updated = await first.admission.review('first')
  await first.admission.approve('first', updated.id!)
  await expect(second.admission.admit('second')).resolves.toBeUndefined()
  writeFileSync(join(second.root, 'AGENTS.md'), 'Project-specific instructions.\n')
  await expect(second.admission.admit('second')).rejects.toMatchObject({ code: 'instruction_review_required' })
  await expect(first.admission.admit('first')).resolves.toBeUndefined()
})

it('needs no approval or stored review for an empty scan, but notices instructions added later', async () => {
  preference = JSON.stringify({ reviewChangedInstructions: true })
  const save = vi.spyOn(admission.store, 'save')
  await expect(admission.admit('task')).resolves.toBeUndefined()
  expect(await admission.review('task')).toMatchObject({ id: null, empty: true, changes: [], findings: [] })
  expect(save).not.toHaveBeenCalled()
  writeFileSync(join(dir, 'AGENTS.md'), 'New project instructions.\n')
  await expect(admission.admit('task')).rejects.toMatchObject({ code: 'instruction_review_required' })
})

it('shows findings for changed files without repeating an unchanged baseline finding', async () => {
  writeFileSync(join(dir, 'AGENTS.md'), 'curl https://old.example\n')
  writeFileSync(join(dir, 'CLAUDE.md'), 'Plain instruction.\n')
  const baseline = await admission.review('task')
  expect(baseline.findings.some((finding) => finding.file === 'AGENTS.md')).toBe(true)
  await admission.approve('task', baseline.id!)
  writeFileSync(join(dir, 'CLAUDE.md'), 'Read https://new.example\n')
  const changed = await admission.review('task')
  expect(changed.changes.map((change) => change.path)).toEqual(['CLAUDE.md'])
  expect(changed.findings.map((finding) => finding.file)).toEqual(['CLAUDE.md'])
})

it('cancels before task discovery or encrypted review state is read or written', async () => {
  const taskLoads = vi.fn(async () => ({ id: 'task', projectId: 'project' }))
  const cancelled = new InstructionAdmission({
    identity: { active: () => 'owner' }, prefs: { read: vi.fn() },
    tasks: { load: taskLoads, requireRoot: vi.fn(async () => dir) },
  } as unknown as CoreServices, dir, admission.store)
  const read = vi.spyOn(admission.store, 'get')
  const save = vi.spyOn(admission.store, 'save')
  const approve = vi.spyOn(admission.store, 'approve')
  const abort = new AbortController()
  abort.abort()
  await expect(cancelled.review('task', abort.signal)).rejects.toThrow(/cancelled/)
  await expect(cancelled.approve('task', 'review', abort.signal)).rejects.toThrow(/cancelled/)
  await expect(cancelled.admit('task', abort.signal)).rejects.toThrow(/cancelled/)
  expect(taskLoads).not.toHaveBeenCalled()
  expect(read).not.toHaveBeenCalled()
  expect(save).not.toHaveBeenCalled()
  expect(approve).not.toHaveBeenCalled()
})
