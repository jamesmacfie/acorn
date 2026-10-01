import { existsSync, writeFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { createPreviewUrlRuntime } from '../../plugins/preview/src/server/previewUrls'

it('counts script URL resolution and a stale pending refresh after disposal', async () => {
  let processes = 0
  let blocked = false
  const waits: (() => void)[] = []
  const core = {
    tasks: { load: async (id: string) => ({ id, projectId: 'project' }), root: async () => '/synthetic/task', active: async () => [] },
    projects: { byId: async () => ({ id: 'project', name: 'Synthetic' }), config: async () => ({ config: { previewMode: 'script', previewValue: 'synthetic command' } }) },
    proc: { runProcess: async () => {
      processes++
      if (blocked) await new Promise<void>(resolve => waits.push(resolve))
      return { stdout: 'http://localhost:3000', code: 0 }
    } },
  } as unknown as Parameters<typeof createPreviewUrlRuntime>[0]
  const emitted: unknown[] = []
  const runtime = createPreviewUrlRuntime(core, () => undefined, frame => emitted.push(frame))
  try {
    const values = await Promise.all(Array.from({ length: 8 }, () => runtime.forTask('task')))
    const simultaneousScripts = processes
    const fresh = createPreviewUrlRuntime(core, () => undefined, frame => emitted.push(frame))
    blocked = true
    const pending = fresh.refresh('other-task')
    for (let step = 0; step < 100 && !waits.length; step++) await Promise.resolve()
    expect(waits).toHaveLength(1)
    fresh.dispose()
    waits.splice(0).forEach(resolve => resolve())
    await pending
    const tag = process.env.ACORN_PERF_TAG ?? 'sample'
    const destination = new URL(`13-preview-${tag}.json`, import.meta.url)
    if (tag.startsWith('before') && existsSync(destination)) throw new Error('Use another before tag.')
    writeFileSync(destination, JSON.stringify({ owner: 'actual PreviewUrlRuntime; synthetic core process capability',
      simultaneousReaders: values.length, simultaneousScripts, emittedAfterDisposedRefresh: emitted,
      note: 'No script executes; counts show repeated capability work and late publication.' }, null, 2) + '\n')
    expect(simultaneousScripts).toBe(8)
    expect(emitted).toHaveLength(1)
    fresh.dispose()
  } finally { runtime.dispose(); waits.splice(0).forEach(resolve => resolve()) }
})
