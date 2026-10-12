import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SecretService, makeTestPluginDb, type TestPluginDb } from '@acorn/plugin-api/testkit'
import type { CoreServices } from '@acorn/plugin-api/node'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { InstructionAdmission } from './instructionAdmission'
import { InstructionReviewStore } from './instructionReviewStore'
import { scanInstructions } from './instructionSnapshot'

let testDb: TestPluginDb
let dir: string
let preference = ''
let admission: InstructionAdmission
const shared = vi.hoisted(() => ({ skills: [] as Array<{ name: string; dir: string }> }))
vi.mock('@acorn/plugin-api/node', () => ({
  deliverableSkills: async () => shared.skills,
  git: async () => ({ code: 0, stdout: 'main\n' }),
}))
beforeEach(() => {
  testDb = makeTestPluginDb('agents')
  dir = mkdtempSync(join(tmpdir(), 'instruction-admission-'))
  preference = ''
  shared.skills = []
  const core = {
    identity: { active: () => 'owner' },
    prefs: { read: async () => preference },
    tasks: { load: async () => ({ id: 'task', projectId: 'project' }), requireRoot: async () => dir },
    projects: { byId: async (id: string) => ({ id, path: dir }) },
  } as unknown as CoreServices
  admission = new InstructionAdmission(
    core,
    dir,
    new InstructionReviewStore(testDb.db, new SecretService('33'.repeat(32))),
  )
})
afterEach(() => {
  testDb.cleanup()
  rmSync(dir, { recursive: true, force: true })
})

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
  const first = await admission.review('project')
  writeFileSync(join(dir, 'AGENTS.md'), 'Second instruction.\n')
  await expect(admission.approve('project', first.id!)).rejects.toThrow(/changed/)
  const second = await admission.review('project')
  await admission.approve('project', second.id!)
  await expect(admission.admit('task')).resolves.toBeUndefined()
  expect(admission.latest('project')).toMatchObject({ taskId: 'task', outcome: 'passed' })
  writeFileSync(join(dir, 'AGENTS.md'), 'Third instruction.\n')
  await expect(admission.admit('task')).rejects.toThrow(/review required/)
})

it('recognizes an unchanged approved snapshot without creating another pending approval', async () => {
  preference = JSON.stringify({ reviewChangedInstructions: true })
  writeFileSync(join(dir, 'AGENTS.md'), 'Read the project documentation.\n')
  const baseline = await admission.review('project')
  await admission.approve('project', baseline.id!)
  const save = vi.spyOn(admission.store, 'save')
  const unchanged = await admission.review('project')
  expect(unchanged).toMatchObject({ id: baseline.id, approved: true, baseline: false, changes: [], findings: [] })
  expect(save).not.toHaveBeenCalled()
  await expect(admission.admit('task')).resolves.toBeUndefined()
})

it('still requires approval when the scan scope changes but the file text does not', async () => {
  preference = JSON.stringify({ reviewChangedInstructions: true })
  writeFileSync(join(dir, 'AGENTS.md'), 'Read the project documentation.\n')
  const snapshot = await scanInstructions(dir, [])
  const older = await admission.store.save('project', { ...snapshot, scope: 'Previous scan coverage' })
  await admission.store.approve(older.id, 'project')
  expect(await admission.review('project')).toMatchObject({ approved: false, baseline: false, changes: [] })
  await expect(admission.admit('task')).rejects.toMatchObject({ code: 'instruction_review_required' })
})

it("shares approval with a worktree holding the same files, but not a moved file or another project's review", async () => {
  preference = JSON.stringify({ reviewChangedInstructions: true })
  writeFileSync(join(dir, 'AGENTS.md'), 'Same bytes.\n')
  const approved = await admission.review('project')
  expect(approved.branch).toBe('main')
  await admission.approve('project', approved.id!)
  const worktree = mkdtempSync(join(tmpdir(), 'instruction-worktree-'))
  try {
    writeFileSync(join(worktree, 'AGENTS.md'), 'Same bytes.\n')
    const inWorktree = new InstructionAdmission(
      {
        identity: { active: () => 'owner' },
        prefs: { read: async () => preference },
        tasks: { load: async () => ({ id: 'other', projectId: 'project' }), requireRoot: async () => worktree },
        projects: { byId: async (id: string) => ({ id, path: worktree }) },
      } as unknown as CoreServices,
      dir,
      admission.store,
    )
    await expect(inWorktree.admit('other')).resolves.toBeUndefined()
    rmSync(join(worktree, 'AGENTS.md'))
    mkdirSync(join(worktree, 'nested'))
    writeFileSync(join(worktree, 'nested', 'AGENTS.md'), 'Same bytes.\n')
    await expect(inWorktree.admit('other')).rejects.toThrow(/review required/)
    await expect(inWorktree.approve('other-project', approved.id!)).rejects.toThrow(/changed/)
  } finally {
    rmSync(worktree, { recursive: true, force: true })
  }
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
    return {
      root,
      admission: new InstructionAdmission(
        {
          identity: { active: () => 'owner' },
          prefs: { read: async () => preference },
          tasks: { load: async () => ({ id, projectId: id }), requireRoot: async () => root },
          projects: { byId: async () => ({ id, path: root }) },
        } as unknown as CoreServices,
        dir,
        admission.store,
      ),
    }
  }
  const first = project('first'),
    second = project('second')
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
  expect(await admission.review('project')).toMatchObject({ id: null, empty: true, changes: [], findings: [] })
  expect(save).not.toHaveBeenCalled()
  writeFileSync(join(dir, 'AGENTS.md'), 'New project instructions.\n')
  await expect(admission.admit('task')).rejects.toMatchObject({ code: 'instruction_review_required' })
})

it('shows findings for changed files without repeating an unchanged baseline finding', async () => {
  writeFileSync(join(dir, 'AGENTS.md'), 'curl https://old.example\n')
  writeFileSync(join(dir, 'CLAUDE.md'), 'Plain instruction.\n')
  const baseline = await admission.review('project')
  expect(baseline.findings.some((finding) => finding.file === 'AGENTS.md')).toBe(true)
  await admission.approve('project', baseline.id!)
  writeFileSync(join(dir, 'CLAUDE.md'), 'Read https://new.example\n')
  const changed = await admission.review('project')
  expect(changed.changes.map((change) => change.path)).toEqual(['CLAUDE.md'])
  expect(changed.findings.map((finding) => finding.file)).toEqual(['CLAUDE.md'])
})

it('cancels before task or project discovery or encrypted review state is read or written', async () => {
  const taskLoads = vi.fn(async () => ({ id: 'task', projectId: 'project' }))
  const projectLoads = vi.fn(async () => ({ id: 'project', path: dir }))
  const cancelled = new InstructionAdmission(
    {
      identity: { active: () => 'owner' },
      prefs: { read: vi.fn() },
      tasks: { load: taskLoads, requireRoot: vi.fn(async () => dir) },
      projects: { byId: projectLoads },
    } as unknown as CoreServices,
    dir,
    admission.store,
  )
  const read = vi.spyOn(admission.store, 'get')
  const save = vi.spyOn(admission.store, 'save')
  const approve = vi.spyOn(admission.store, 'approve')
  const abort = new AbortController()
  abort.abort()
  await expect(cancelled.review('project', abort.signal)).rejects.toThrow(/cancelled/)
  await expect(cancelled.approve('project', 'review', abort.signal)).rejects.toThrow(/cancelled/)
  await expect(cancelled.admit('task', abort.signal)).rejects.toThrow(/cancelled/)
  expect(taskLoads).not.toHaveBeenCalled()
  expect(projectLoads).not.toHaveBeenCalled()
  expect(read).not.toHaveBeenCalled()
  expect(save).not.toHaveBeenCalled()
  expect(approve).not.toHaveBeenCalled()
})
