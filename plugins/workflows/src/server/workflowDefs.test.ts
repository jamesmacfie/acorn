import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeTestPluginDb, type TestPluginDb } from '@acorn/plugin-api/testkit'
import { createDef, defsForProject, getDef, mergedList, removeDef, saveDefToRepo, updateDef } from './workflowDefs'
import type { WorkflowValidationCatalog } from './workflowValidation'
import type { WorkflowDef } from '../shared/workflowContracts'

// The second store a definition can live in (docs/workflows.md § Database definitions). What matters
// here is the merged read's precedence, the stale-revision refusal, and that save-to-repo writes
// inside the folder and nowhere else.

const catalog: WorkflowValidationCatalog = {
  stepKinds: new Set(['agent']),
  policies: new Set(),
  profiles: new Set(['claude-code']),
  structuredProfiles: new Set(['claude-code']),
}

const def = (name: string): WorkflowDef => ({ name, steps: [{ name: 'only', prompt: 'Do it.' }] })

// Stands in for `ctx.core.fs.resolveInRoot`, the symlink-aware confinement the node wires in. What
// the store owes is honouring the answer, which is what the last case here checks.
const resolveInRoot = (root: string, relPath: string) => (relPath.includes('..') ? null : join(root, relPath))

describe('workflow definitions stored as rows', () => {
  let store: TestPluginDb
  let dir: string

  const writeFile = (base: string, id: string, text: string) => {
    mkdirSync(join(base, '.acorn', 'workflows'), { recursive: true })
    writeFileSync(join(base, '.acorn', 'workflows', `${id}.toml`), text)
  }

  beforeEach(() => {
    store = makeTestPluginDb('workflows')
    dir = mkdtempSync(join(tmpdir(), 'acorn-wdefs-'))
  })
  afterEach(() => {
    store.cleanup()
    rmSync(dir, { recursive: true, force: true })
  })

  it('creates, reads, updates and deletes a row', async () => {
    const row = await createDef(store.db, { workspaceId: 'w1', def: def('Ship it') })
    expect(row).toMatchObject({ workspaceId: 'w1', projectId: null, name: 'Ship it', revision: 1 })
    expect(await getDef(store.db, row.id)).toEqual(row)

    const saved = await updateDef(store.db, row.id, def('Ship it twice'), 1)
    expect(saved).toMatchObject({ row: { name: 'Ship it twice', revision: 2 } })
    expect((await getDef(store.db, row.id))?.revision).toBe(2)

    await removeDef(store.db, row.id)
    expect(await getDef(store.db, row.id)).toBeNull()
    expect(await updateDef(store.db, row.id, def('gone'), 1)).toBeNull()
  })

  it('refuses a save against a revision somebody else has moved', async () => {
    const row = await createDef(store.db, { workspaceId: 'w1', def: def('Ship it') })
    await updateDef(store.db, row.id, def('Renamed'), 1)
    const stale = await updateDef(store.db, row.id, def('My version'), 1)
    expect(stale).toMatchObject({ conflict: { name: 'Renamed', revision: 2 } })
    // Nothing was written: the row that won is still the row.
    expect((await getDef(store.db, row.id))?.name).toBe('Renamed')
  })

  it('strips the loader’s own id and layer, so a copied file does not ask for a trust snapshot', async () => {
    const copied = { ...def('Copied'), id: 'ship', source: 'repo' } as WorkflowDef
    const row = await createDef(store.db, { workspaceId: 'w1', def: copied })
    expect(row.def).not.toHaveProperty('source')
    expect(row.def).not.toHaveProperty('id')
  })

  it('shows a task only the rows of its own workspace, bound to its project or to none', async () => {
    const mine = await createDef(store.db, { workspaceId: 'w1', def: def('Anywhere') })
    const bound = await createDef(store.db, { workspaceId: 'w1', projectId: 'p1', def: def('Only p1') })
    await createDef(store.db, { workspaceId: 'w1', projectId: 'p2', def: def('Only p2') })
    await createDef(store.db, { workspaceId: 'w2', def: def('Another workspace') })

    const visible = await defsForProject(store.db, 'w1', 'p1')
    expect(visible.map((row) => row.id).sort()).toEqual([mine.id, bound.id].sort())
  })

  it('merges rows under the file layers, with repo over user over database on one id', async () => {
    const repo = join(dir, 'repo')
    const user = join(dir, 'home')
    mkdirSync(repo)
    mkdirSync(user)
    writeFile(repo, 'shared', 'name = "the committed one"\n[[steps]]\nname = "a"\nprompt = "x"\n')
    writeFile(user, 'shared', 'name = "the user one"\n[[steps]]\nname = "a"\nprompt = "x"\n')
    writeFile(user, 'mine-only', 'name = "user only"\n[[steps]]\nname = "a"\nprompt = "x"\n')
    await createDef(store.db, { workspaceId: 'w1', projectId: 'p1', def: def('a row') })

    const merged = await mergedList(store.db, 'w1', [{ id: 'p1', path: repo }], { userDir: user, catalog })
    expect(merged.errors).toEqual([])
    const byId = new Map(merged.workflows.map((workflow) => [workflow.id, workflow]))
    expect(byId.get('shared')).toMatchObject({ source: 'repo', name: 'the committed one', projectId: 'p1' })
    expect(byId.get('mine-only')).toMatchObject({ source: 'user', projectId: null })
    expect([...byId.values()].filter((workflow) => workflow.source === 'database')).toHaveLength(1)
  })

  it('lets a committed definition expand a sub-workflow from the user layer', async () => {
    const repo = join(dir, 'repo')
    const user = join(dir, 'home')
    mkdirSync(repo)
    mkdirSync(user)
    writeFile(user, 'review-block', 'name = "review"\n[[steps]]\nname = "look"\nprompt = "Review."\n')
    writeFile(repo, 'main-flow', 'name = "main"\n[[steps]]\nname = "build"\nprompt = "Build."\n[[steps]]\nworkflow = "review-block"\n')

    const merged = await mergedList(store.db, 'w1', [{ id: 'p1', path: repo }], { userDir: user, catalog })
    expect(merged.errors).toEqual([])
    const main = merged.workflows.find((workflow) => workflow.id === 'main-flow')
    expect(main?.steps.map((step) => step.name)).toEqual(['build', 'review-block:look'])
  })

  it('marks a row whose project has been deleted', async () => {
    await createDef(store.db, { workspaceId: 'w1', projectId: 'gone', def: def('orphan') })
    const merged = await mergedList(store.db, 'w1', [{ id: 'p1', path: null }], { userDir: null, catalog })
    expect(merged.workflows[0].problems).toEqual(['The project this workflow was bound to has been removed.'])
  })

  it('saves to the repository as a slug of the name and deletes the row', async () => {
    const row = await createDef(store.db, { workspaceId: 'w1', def: def('Investigate an issue') })
    const saved = await saveDefToRepo(store.db, row.id, { checkoutDir: dir, keepRow: false, resolveInRoot })
    expect(saved).toEqual({ path: '.acorn/workflows/investigate-an-issue.toml' })
    expect(readFileSync(join(dir, '.acorn', 'workflows', 'investigate-an-issue.toml'), 'utf8')).toContain('name = "Investigate an issue"')
    expect(await getDef(store.db, row.id)).toBeNull()
  })

  it('keeps the row when asked, and never writes outside the folder', async () => {
    const row = await createDef(store.db, { workspaceId: 'w1', def: def('../../etc/passwd') })
    const saved = await saveDefToRepo(store.db, row.id, { checkoutDir: dir, keepRow: true, resolveInRoot })
    expect(saved).toEqual({ path: '.acorn/workflows/etc-passwd.toml' })
    expect(readdirSync(join(dir, '.acorn', 'workflows'))).toEqual(['etc-passwd.toml'])
    expect(await getDef(store.db, row.id)).not.toBeNull()
  })

  it('does not overwrite a file the repository already has', async () => {
    writeFile(dir, 'ship-it', 'name = "the committed one"\n[[steps]]\nname = "a"\nprompt = "x"\n')
    const row = await createDef(store.db, { workspaceId: 'w1', def: def('Ship it') })
    expect(await saveDefToRepo(store.db, row.id, { checkoutDir: dir, keepRow: true, resolveInRoot })).toEqual({
      path: '.acorn/workflows/ship-it-2.toml',
    })
  })

  it('writes nothing when the confinement check refuses the path', async () => {
    const row = await createDef(store.db, { workspaceId: 'w1', def: def('Ship it') })
    expect(await saveDefToRepo(store.db, row.id, { checkoutDir: dir, keepRow: true, resolveInRoot: () => null })).toEqual({ error: 'outside_checkout' })
    // Not even the folder: the check runs before `mkdir -p`, so a symlinked `.acorn` is not followed.
    expect(existsSync(join(dir, '.acorn'))).toBe(false)
  })

  it('answers not_found for a row that is gone', async () => {
    expect(await saveDefToRepo(store.db, 'nope', { checkoutDir: dir, keepRow: false, resolveInRoot })).toEqual({ error: 'not_found' })
  })
})
