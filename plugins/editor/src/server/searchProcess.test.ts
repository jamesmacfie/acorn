import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runRipgrep } from './searchProcess'
import { searchInFiles } from './search'

let root: string
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'acorn-search-')) })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })
const args = ['--json', '--no-config', '--fixed-strings', '--', 'needle', '.']
const opts = { caseSensitive: false, wholeWord: false, regex: false }

describe('owned ripgrep search', () => {
  it.each([2000, 8000, 100000])('retains the exact first 2000 of %i matches and proves truncation', async (count) => {
    await writeFile(join(root, 'matches.txt'), '🙂 café needle\n'.repeat(count))
    const result = await runRipgrep(root, args)
    expect(result.truncated).toBe(count > 2000)
    expect(result.files).toHaveLength(1)
    expect(result.files[0].path).toBe('matches.txt')
    expect(result.files[0].hits).toEqual(Array.from({ length: 2000 }, (_, index) => ({
      line: index + 1, col: 9, endCol: 15, preview: '🙂 café needle',
    })))
  })

  it('preserves late matches in a minified Unicode line across output chunks', async () => {
    const prefix = '🙂'.repeat(100000)
    await writeFile(join(root, 'long.txt'), prefix + 'needle\n')
    const result = await runRipgrep(root, args)
    expect(result.files[0].hits[0]).toEqual({ line: 1, col: 200001, endCol: 200007, preview: prefix.slice(0, 300) })
  })

  it('distinguishes no match, invalid regex, and a missing task root', async () => {
    await writeFile(join(root, 'empty.txt'), 'no match\n')
    expect(await runRipgrep(root, args)).toEqual({ files: [], truncated: false })
    await expect(runRipgrep(root, ['--json', '--no-config', '--', '[', '.'])).rejects.toMatchObject({ code: 'invalid_query' })
    await expect(searchInFiles({ tasks: { root: async () => null } } as never, 'task', 'needle', opts)).rejects.toMatchObject({ code: 'unavailable_root' })
  })

  it('reports launch failure, timeout, pre-abort, malformed output, and record overflow', async () => {
    await expect(runRipgrep(root, args, { executable: join(root, 'missing') })).rejects.toMatchObject({ code: 'launch_failed' })
    await expect(runRipgrep(root, ['-e', 'setInterval(() => {}, 1000)'], { executable: process.execPath, timeoutMs: 30 })).rejects.toMatchObject({ code: 'timeout' })
    await expect(runRipgrep(root, args, { signal: AbortSignal.abort() })).rejects.toMatchObject({ code: 'cancelled' })
    await expect(runRipgrep(root, ['-e', 'console.log("not json")'], { executable: process.execPath })).rejects.toMatchObject({ code: 'invalid_output' })
    await expect(runRipgrep(root, ['-e', 'console.log("x".repeat(4096))'], { executable: process.execPath, maxRecordBytes: 1024 })).rejects.toMatchObject({ code: 'overflow' })
  })

  it('joins a cancelled child before settling even when SIGTERM is ignored', async () => {
    const pidFile = join(root, 'pid.txt')
    const controller = new AbortController()
    const run = runRipgrep(root, ['-e', `require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)`],
      { executable: process.execPath, signal: controller.signal })
    const failure = run.catch((error: unknown) => error)
    const { readFile } = await import('node:fs/promises')
    let pid = 0
    for (let attempt = 0; attempt < 100 && !pid; attempt++) {
      pid = Number(await readFile(pidFile, 'utf8').catch(() => '0'))
      if (!pid) await new Promise((resolve) => setTimeout(resolve, 10))
    }
    expect(pid).toBeGreaterThan(0)
    controller.abort()
    expect(await failure).toMatchObject({ code: 'cancelled' })
    expect(() => process.kill(pid, 0)).toThrow()
  })
})
