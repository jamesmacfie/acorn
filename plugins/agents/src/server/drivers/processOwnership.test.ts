import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AcpDriver } from './acpDriver'
import { CodexAgentDriver } from './codexDriver'
import { JsonRpcProcess } from './jsonRpcProcess'
import { FakeAgentDriver } from './fake'
import type { AgentDriverStartOptions } from './types'
import { capturePty } from '../usage/processRunner'
import { readCodexRateLimitsViaRpc } from '../usage/codexUsage'

const fixture = fileURLToPath(new URL('../../testkit/ownedAgent.mjs', import.meta.url))
const alive = (pid: number) => {
  try { process.kill(pid, 0); return true } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false
    throw error
  }
}
type Pids = { child: number; grandchild: number }
const evidence: Record<string, unknown> = {}
const shellQuote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'"

// Every assertion follows production stop acknowledgement. No external signal cleans these fixtures.
describe.skipIf(process.platform === 'win32')('native Agents process ownership', () => {
  let root: string
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true })
    if (process.env.ACORN_PROCESS_EVIDENCE_DIR) {
      await writeFile(join(process.env.ACORN_PROCESS_EVIDENCE_DIR, 'unit10-native-after.json'), JSON.stringify(evidence, null, 2) + '\n')
    }
    vi.unstubAllEnvs()
  })
  const setup = async (mode: string) => {
    root = await mkdtemp(join(tmpdir(), 'acorn-owned-agent-'))
    const pidFile = join(root, 'pids.json')
    const pids = async (): Promise<Pids> => {
      let result!: Pids
      await vi.waitFor(async () => { result = JSON.parse(await readFile(pidFile, 'utf8')); expect(result.grandchild).toBeGreaterThan(0) }, { timeout: 10_000 })
      return result
    }
    const options: AgentDriverStartOptions = {
      session: { id: 'synthetic', providerSessionRef: null, config: {} } as AgentDriverStartOptions['session'],
      cwd: root, env: {}, mcpServers: [], noProviderExecutionHistory: true,
      onEvent: () => {}, onClosed: () => {},
    }
    const acp = new AcpDriver({ id: 'synthetic', profileId: 'synthetic', label: 'Synthetic', spawn: { entry: () => fixture, args: [mode, pidFile] } })
    const executable = join(root, 'codex')
    await writeFile(executable, `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(fixture)} ${shellQuote(mode)} ${shellQuote(pidFile)} "$@"\n`, { mode: 0o700 })
    const codex = new CodexAgentDriver()
    vi.spyOn(codex, 'probe').mockResolvedValue({ ...await new FakeAgentDriver().probe(), id: 'codex', profileId: 'codex', executable })
    const record = (owned: Pids, started: number) => {
      const result = { ...owned, stopWallMs: performance.now() - started, childAlive: alive(owned.child), grandchildAlive: alive(owned.grandchild) }
      evidence[mode] = result
      expect(result.childAlive).toBe(false)
      expect(result.grandchildAlive).toBe(false)
    }
    return { options, acp, codex, pidFile, pids, record }
  }

  it.each(['rpc', 'parent-exit', 'overflow', 'disconnect'])('acknowledges JSON-RPC closure and retires the group: %s', async (mode) => {
    const test = await setup(mode)
    const rpc = new JsonRpcProcess({ command: process.execPath, args: [fixture, mode, test.pidFile], cwd: root, env: {}, maxBufferedBytes: 1024 })
    const owned = await test.pids()
    try {
      if (mode === 'overflow' || mode === 'disconnect') await expect(rpc.request(mode)).rejects.toThrow(/exceeded|closed/)
      const started = performance.now()
      const first = rpc.stop()
      expect(rpc.stop()).toBe(first)
      await first
      test.record(owned, started)
    } finally { await rpc.stop() }
  })

  it.each(['acp-fail', 'codex-fail', 'acp-hold', 'codex-hold'])('retires rejected or cancelled initialization: %s', async (mode) => {
    const test = await setup(mode)
    const controller = new AbortController()
    const starting = (mode.startsWith('acp') ? test.acp : test.codex).start({ ...test.options, signal: controller.signal })
    const settled = starting.then((handle) => ({ handle }), (error: unknown) => ({ error }))
    try {
      const owned = await test.pids()
      const started = performance.now()
      if (mode.endsWith('hold')) controller.abort(new Error('cancel startup'))
      expect(await settled).toMatchObject({ error: { message: expect.stringContaining(
        mode.endsWith('fail') ? 'synthetic handshake rejected' : 'cancel startup',
      ) } })
      test.record(owned, started)
    } finally {
      controller.abort(new Error('retire failed fixture'))
      const result = await settled
      if ('handle' in result) await result.handle.stop()
    }
  })

  it.each(['acp-close', 'codex-close'])('bounds a held protocol close and joins repeated stops: %s', async (mode) => {
    const test = await setup(mode)
    const handle = await (mode.startsWith('acp') ? test.acp : test.codex).start(test.options)
    const owned = await test.pids()
    const started = performance.now()
    await Promise.all([handle.stop(), handle.stop()])
    test.record(owned, started)
    expect(performance.now() - started).toBeLessThan(6000)
  })

  it('retires an ACP child when the protocol stream closes during a turn', async () => {
    const test = await setup('acp-disconnect')
    const handle = await test.acp.start(test.options)
    const owned = await test.pids()
    const started = performance.now()
    try {
      await expect(handle.sendTurn({ turn: {} as never, input: [{ type: 'text', text: 'synthetic' }], attachments: {} })).rejects.toThrow()
      await handle.stop()
      test.record(owned, started)
    } finally { await handle.stop() }
  })

  it.each(['pty-idle', 'pty-timeout', 'pty-overflow'])('acknowledges PTY retirement before capture settles: %s', async (mode) => {
    const test = await setup(mode)
    const started = performance.now()
    const capture = capturePty({ command: process.execPath, args: [fixture, mode, test.pidFile], cwd: root, idleMs: mode === 'pty-idle' ? 10 : 10_000, timeoutMs: 5_000, maxBytes: mode === 'pty-overflow' ? 3 : 1024, killEscalationMs: 30 })
    const result = mode === 'pty-idle' ? expect(capture).resolves.toMatchObject({ exitCode: null }) : expect(capture).rejects.toMatchObject({ code: mode === 'pty-timeout' ? 'timeout' : 'output_limit' })
    const owned = await test.pids()
    await result
    test.record(owned, started)
  })

  it('retires the read-only Codex usage app-server before returning', async () => {
    const test = await setup('codex-usage')
    vi.stubEnv('PATH', `${root}:${process.env.PATH}`)
    const started = performance.now()
    await readCodexRateLimitsViaRpc()
    test.record(await test.pids(), started)
  })
})
