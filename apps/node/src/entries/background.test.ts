import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

describe('detached Node log', () => {
  it('rotates at the size bound without losing the writable stream', () => {
    const dir = mkdtempSync(join(tmpdir(), 'acorn-cli-log-'))
    try {
      const path = join(dir, 'service.log')
      const moduleUrl = pathToFileURL(fileURLToPath(new URL('./background.ts', import.meta.url))).href
      const script = `import { installBackgroundLog } from ${JSON.stringify(moduleUrl)};
        installBackgroundLog(${JSON.stringify(path)});
        process.stdout.write('a'.repeat(5 * 1024 * 1024));
        process.stderr.write('b'.repeat(5 * 1024 * 1024));`
      const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
        cwd: fileURLToPath(new URL('../..', import.meta.url)), encoding: 'utf8',
      })
      expect(child.status, child.stderr).toBe(0)
      expect(statSync(path).size).toBe(5 * 1024 * 1024)
      expect(statSync(`${path}.1`).size).toBe(5 * 1024 * 1024)
      if (process.platform !== 'win32') expect(statSync(path).mode & 0o777).toBe(0o600)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
