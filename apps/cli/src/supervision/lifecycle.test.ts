import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, type ChildProcess } from 'node:child_process'
import { createInterface } from 'node:readline'
import { afterEach, describe, expect, it } from 'vitest'
import { custody } from '@acorn/custody/local'
import { LOCAL_TOKEN_SCOPE } from '@acorn/custody/custody/deviceTokenStore.ts'
import { nodeServiceStatus, startNodeService, stopNodeService } from './lifecycle'
import { servicePaths } from './record'

const keys = ['ACORN_DATA_DIR', 'ACORN_TUI_CONFIG_DIR', 'ACORN_CLI_NODE_ENTRY', 'ACORN_PORT'] as const
const initial = Object.fromEntries(keys.map((key) => [key, process.env[key]]))
let base: string | undefined
let root: string | undefined
let manual: ChildProcess | undefined

function isolatedRoot(): string {
  base = mkdtempSync(join(tmpdir(), 'acorn-cli-service-'))
  root = join(base, 'node') // absent on purpose: first run must bootstrap without stdin
  process.env.ACORN_DATA_DIR = root
  process.env.ACORN_TUI_CONFIG_DIR = join(base, 'custody')
  process.env.ACORN_CLI_NODE_ENTRY = fileURLToPath(new URL('../../../node/src/entries/standalone.ts', import.meta.url))
  delete process.env.ACORN_PORT
  return root
}

afterEach(async () => {
  manual?.kill('SIGTERM')
  manual = undefined
  if (root) await stopNodeService(true, root).catch(() => undefined)
  if (base) rmSync(base, { recursive: true, force: true })
  base = undefined
  root = undefined
  for (const key of keys) {
    const value = initial[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe('CLI-owned local Node', () => {
  it('serializes racing starts, hands off the token privately, and survives the launching command', async () => {
    const dataDir = isolatedRoot()
    const [first, second] = await Promise.all([startNodeService(dataDir), startNodeService(dataDir)])
    expect(first.state).toBe('running')
    expect(second.pid).toBe(first.pid)
    expect((await nodeServiceStatus(dataDir)).state).toBe('running')
    const token = custody().tokens.read(LOCAL_TOKEN_SCOPE)
    expect(token).toMatch(/^acorn_dt_/)
    const paths = servicePaths(dataDir)
    for (const path of [paths.record, paths.log]) {
      expect(statSync(path).mode & 0o777).toBe(0o600)
      expect(readFileSync(path, 'utf8')).not.toContain(token!)
    }
    expect(await stopNodeService(false, dataDir)).toMatchObject({ state: 'stopped' })
    expect(await nodeServiceStatus(dataDir)).toMatchObject({ state: 'stopped' })
  }, 90_000)

  it('refuses to stop a PID whose authenticated instance no longer matches its record', async () => {
    const dataDir = isolatedRoot()
    await startNodeService(dataDir)
    const path = servicePaths(dataDir).record
    const original = readFileSync(path, 'utf8')
    const tampered = { ...JSON.parse(original), instanceId: '00000000-0000-4000-8000-000000000001' }
    writeFileSync(path, JSON.stringify(tampered), { mode: 0o600 })
    expect((await nodeServiceStatus(dataDir)).state).toBe('running-unowned')
    await expect(stopNodeService(false, dataDir)).rejects.toMatchObject({ code: 'node_not_owned' })
    writeFileSync(path, original, { mode: 0o600 })
    expect((await nodeServiceStatus(dataDir)).state).toBe('running')
  }, 90_000)

  it('reports a manually started standalone Node as running-unowned', async () => {
    const dataDir = isolatedRoot()
    const entry = process.env.ACORN_CLI_NODE_ENTRY!
    manual = spawn(process.execPath, ['--import', 'tsx', entry], {
      cwd: fileURLToPath(new URL('../../../node', import.meta.url)),
      env: { ...process.env, ACORN_DATA_DIR: dataDir, ACORN_CLI_BACKGROUND: undefined,
        ACORN_CLI_SERVICE_ID: undefined, ACORN_CLI_LOG_PATH: undefined },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    manual.stderr?.resume()
    await new Promise<void>((resolve, reject) => {
      const lines = createInterface({ input: manual!.stdout! })
      lines.on('line', (line) => {
        try { if ((JSON.parse(line) as { deviceToken?: unknown }).deviceToken) { lines.close(); resolve() } }
        catch { /* startup log, not the handshake */ }
      })
      manual!.once('exit', (code) => reject(new Error(`Manual Node exited before readiness (${code}).`)))
    })
    expect((await nodeServiceStatus(dataDir)).state).toBe('running-unowned')
    expect((await startNodeService(dataDir)).state).toBe('running-unowned')
    await expect(stopNodeService(false, dataDir)).rejects.toMatchObject({ code: 'node_not_owned' })
  }, 90_000)

  it('releases the startup claim after a child exits before readiness', async () => {
    const dataDir = isolatedRoot()
    const sourceEntry = process.env.ACORN_CLI_NODE_ENTRY!
    const failedEntry = join(base!, 'fail.mjs')
    writeFileSync(failedEntry, 'throw new Error("synthetic early boot failure")\n')
    process.env.ACORN_CLI_NODE_ENTRY = failedEntry
    await expect(startNodeService(dataDir)).rejects.toThrow('before readiness')
    expect(readFileSync(servicePaths(dataDir).log, 'utf8')).toContain('synthetic early boot failure')
    expect(existsSync(servicePaths(dataDir).claim)).toBe(false)
    expect((await nodeServiceStatus(dataDir)).state).toBe('stopped')
    process.env.ACORN_CLI_NODE_ENTRY = sourceEntry
    expect((await startNodeService(dataDir)).state).toBe('running')
  }, 90_000)
})
