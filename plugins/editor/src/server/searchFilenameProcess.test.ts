import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'

const roots: string[] = []
afterEach(async () => {
  vi.doUnmock('@vscode/ripgrep')
  vi.resetModules()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function filenamePass(program: string) {
  const root = await mkdtemp(join(tmpdir(), 'editor-filename-process-'))
  roots.push(root)
  const executable = join(root, 'rg')
  await writeFile(executable, `#!${process.execPath}\n${program}\n`)
  await chmod(executable, 0o755)
  vi.doMock('@vscode/ripgrep', () => ({ rgPath: executable }))
  const { listFilteredPaths } = await import('./searchProcess')
  return { root, run: (signal?: AbortSignal) => listFilteredPaths(root, '.', ['*.tsx'], [], signal) }
}

async function childPid(path: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const pid = Number(await readFile(path, 'utf8').catch(() => '0'))
    if (pid) return pid
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('The filename process did not start')
}

it('joins a cancelled filename pass after killing a SIGTERM-resistant child', async () => {
  const { root, run } = await filenamePass(`
    require('fs').writeFileSync('pid', String(process.pid))
    process.on('SIGTERM', () => {})
    setInterval(() => {}, 1000)
  `)
  const controller = new AbortController()
  const pending = run(controller.signal).catch((error: unknown) => error)
  const pid = await childPid(join(root, 'pid'))
  controller.abort()
  expect(await pending).toMatchObject({ code: 'cancelled' })
  expect(() => process.kill(pid, 0)).toThrow()
})

it('joins a timed-out filename pass after killing a SIGTERM-resistant child', async () => {
  const { root, run } = await filenamePass(`
    require('fs').writeFileSync('pid', String(process.pid))
    process.on('SIGTERM', () => {})
    setInterval(() => {}, 1000)
  `)
  const pending = run().catch((error: unknown) => error)
  const pid = await childPid(join(root, 'pid'))
  expect(await pending).toMatchObject({ code: 'timeout' })
  expect(() => process.kill(pid, 0)).toThrow()
}, 15_000)

it('reports filename output overflow before the timeout', async () => {
  const { run } = await filenamePass(`process.stdout.write('x'.repeat(5 * 1024 * 1024))`)
  await expect(run()).rejects.toMatchObject({ code: 'overflow' })
})
