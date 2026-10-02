import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { runProcess } from '../../packages/node-core/src/server/core/proc'
import { createPreviewUrlRuntime } from '../../plugins/preview/src/server/previewUrls'

it('joins real script children and drains failure and deadline processes in a disposable repository', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'acorn-preview-unit22-'))
  let calls = 0
  let script = 'echo $$ >> pids; sleep 0.05; echo http://localhost:3000'
  const service = {
    tasks: { load: async (id: string) => ({ id, projectId: 'project', title: 'Synthetic' }), root: async () => cwd },
    projects: { byId: async () => ({ id: 'project', name: 'Synthetic' }), config: async () => ({ config: { previewMode: 'script', previewValue: script } }) },
    proc: { runProcess: (spec: Parameters<typeof runProcess>[0]) => { calls++; return runProcess(spec) } },
  } as unknown as Parameters<typeof createPreviewUrlRuntime>[0]
  const runtime = createPreviewUrlRuntime(service, () => undefined, () => {})
  try {
    const values = await Promise.all(Array.from({ length: 8 }, () => runtime.forTask('task')))
    expect(calls).toBe(1)
    expect(values.every(value => value?.url === 'http://localhost:3000')).toBe(true)
    script = 'echo $$ >> pids; exit 1'
    expect(await runtime.forTask('task')).toBeNull()
    script = 'echo $$ >> pids; sleep 30'
    expect(await runtime.forTask('task')).toBeNull()
    const pids = readFileSync(join(cwd, 'pids'), 'utf8').trim().split('\n').map(Number)
    for (const pid of pids) expect(() => process.kill(pid, 0)).toThrow()
    writeFileSync(new URL('./unit22-real-process-after.json', import.meta.url), JSON.stringify({
      runtime: process.version, owner: 'PreviewUrlRuntime through core.runProcess', readers: 8,
      joinedProcessCalls: 1, failureAndDeadlineCalls: calls - 1, deadlineMs: 10_000,
      recordedShellPids: pids.length, allRecordedShellPidsGone: true,
      note: 'Disposable repository; no visible latency or retained memory measurement.',
    }, null, 2) + '\n')
  } finally { runtime.dispose(); rmSync(cwd, { recursive: true, force: true }) }
}, 20_000)
