import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ToolError, type ToolContext } from '@acorn/plugin-api/node'
import { createApp, patchApp, readApp, showApp, writeApp, type AppToolDeps } from './handlers'
import { AppStore } from './store'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function world(planProblems: (plan: unknown) => string[] = () => []) {
  const root = mkdtempSync(join(tmpdir(), 'trellis-'))
  roots.push(root)
  const store = new AppStore(root)
  const deps: AppToolDeps = {
    store: async () => store,
    workspaceOf: async () => 'w',
    planProblems: async (_workspace, plan) => planProblems(plan),
    planGuide: async () => ({}),
    changed: vi.fn(),
  }
  const ctx: ToolContext = { taskId: 't1', userLogin: 'owner' }
  return { root, store, deps, ctx }
}

const plan = { version: 2, title: 'Open work' }

describe('the app tools', () => {
  it('builds an app from files under the data root and shows it as revision 1', async () => {
    const { root, store, deps, ctx } = world()
    const { appId, program } = await createApp(deps, { name: 'Checklist', description: 'Steps' }, ctx)
    await writeApp(deps, { appId, file: 'plans/open', content: JSON.stringify(plan) }, ctx)
    await writeApp(
      deps,
      { appId, file: 'program', content: 'root = Stack([Heading("Open work"), Panel("open")])', hash: program.hash },
      ctx,
    )
    expect(await showApp(deps, { appId, note: 'First version.' }, ctx)).toEqual({
      appId,
      name: 'Checklist',
      revision: 1,
    })
    expect(readdirSync(join(root, appId, 'revisions', '1')).sort()).toEqual(['plans', 'program.oui', 'revision.json'])
    expect(await store.summary(appId)).toMatchObject({ head: 1, revisions: [{ revision: 1, note: 'First version.' }] })
    expect(await store.revisionFiles(appId, 1)).toEqual({
      program: 'root = Stack([Heading("Open work"), Panel("open")])',
      plans: { open: plan },
    })
  })

  it('records the session that last showed an app as its building session, and says its head moved', async () => {
    const { store, deps, ctx } = world()
    const { appId, program } = await createApp(deps, { name: 'A', description: '' }, { ...ctx, sessionId: 's1' })
    expect((await store.meta(appId))?.sessionId).toBe('s1')
    await writeApp(deps, { appId, file: 'program', content: 'root = Stack([Text("a")])', hash: program.hash }, ctx)
    await showApp(deps, { appId, note: 'First.' }, { ...ctx, sessionId: 's2' })
    expect(await store.meta(appId)).toMatchObject({ sessionId: 's2', head: 1, updatedAt: expect.any(Number) })
    expect(deps.changed).toHaveBeenCalledWith(expect.objectContaining({ appId }))
  })

  it('needs the current hash to replace a file, and patches statements by name', async () => {
    const { deps, ctx } = world()
    const { appId, program } = await createApp(deps, { name: 'A', description: '' }, ctx)
    const written = await writeApp(
      deps,
      { appId, file: 'program', content: 'root = Stack([a, b])\na = Text("a")\nb = Text("b")', hash: program.hash },
      ctx,
    )
    await expect(
      writeApp(deps, { appId, file: 'program', content: 'root = Text("x")', hash: program.hash }, ctx),
    ).rejects.toMatchObject({
      kind: 'conflict',
    })
    await patchApp(deps, { appId, statements: 'a = Text("A")\nb = null', hash: written.hash }, ctx)
    const read = await readApp(deps, { appId, file: 'program' }, ctx)
    expect(read).toMatchObject({ content: expect.stringContaining('a = Text("A")') })
    expect((read as { content: string }).content).not.toContain('b = Text')
  })

  it("treats another task's app as missing", async () => {
    const { deps, ctx } = world()
    const { appId } = await createApp(deps, { name: 'A', description: '' }, ctx)
    const other = { ...ctx, taskId: 't2' }
    for (const call of [
      () => readApp(deps, { appId }, other),
      () => writeApp(deps, { appId, file: 'plans/x', content: '{}' }, other),
      () => showApp(deps, { appId, note: 'x' }, other),
    ])
      await expect(call()).rejects.toMatchObject({ kind: 'not_found' })
  })

  it('fails with every problem, with its code and path, and publishes nothing', async () => {
    const { store, deps, ctx } = world(() => ['/view/x: A bar chart needs an enum or person axis.'])
    const { appId, program } = await createApp(deps, { name: 'A', description: '' }, ctx)
    await writeApp(deps, { appId, file: 'plans/open', content: JSON.stringify(plan) }, ctx)
    await writeApp(deps, { appId, file: 'program', content: 'root = Stack([Chart("open")])', hash: program.hash }, ctx)
    const failure = await showApp(deps, { appId, note: 'x' }, ctx).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(ToolError)
    expect((failure as ToolError).message.split('\n')).toEqual([
      'plan /plans/open/view/x: A bar chart needs an enum or person axis.',
      expect.stringMatching(/^unknown-component \/program\/root/),
      'unused-plan /plans/open: No Query or Panel reads the plan open. Use it, or delete it with app_write and content null.',
    ])
    expect((await store.summary(appId))?.head).toBe(0)
  })

  it('refuses a plan that is not one JSON object', async () => {
    const { deps, ctx } = world()
    const { appId } = await createApp(deps, { name: 'A', description: '' }, ctx)
    await expect(writeApp(deps, { appId, file: 'plans/open', content: '[1]' }, ctx)).rejects.toMatchObject({
      kind: 'bad_request',
    })
  })
})

describe('restoring a revision', () => {
  it('publishes the old files as the next revision, and the working files follow', async () => {
    const { store, deps, ctx } = world()
    const { appId, program } = await createApp(deps, { name: 'A', description: '' }, ctx)
    let hash = (
      await writeApp(deps, { appId, file: 'program', content: 'root = Text("one")', hash: program.hash }, ctx)
    ).hash!
    await showApp(deps, { appId, note: 'One.' }, ctx)
    hash = (await writeApp(deps, { appId, file: 'program', content: 'root = Text("two")', hash }, ctx)).hash!
    await showApp(deps, { appId, note: 'Two.' }, ctx)
    const old = (await store.revision(appId, 1))!
    expect(
      await store.publish(
        appId,
        old.files,
        { ...old.meta, note: 'Restored v1.', restoredFrom: 1 },
        { toWorking: true },
      ),
    ).toBe(3)
    expect(await store.summary(appId)).toMatchObject({ head: 3, revisions: [{}, {}, { revision: 3, restoredFrom: 1 }] })
    expect((await store.read(appId, 'program'))?.content).toBe('root = Text("one")')
  })
})
