import { it, expect } from 'vitest'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'
import { JsonRpcProcess } from '../../plugins/agents/src/server/drivers/jsonRpcProcess'
import { AcpDriver } from '../../plugins/agents/src/server/drivers/acpDriver'
import { CodexAgentDriver } from '../../plugins/agents/src/server/drivers/codexDriver'
import { capturePty } from '../../plugins/agents/src/server/usage/processRunner'

const fixture = fileURLToPath(new URL('./09-owned-child.mjs', import.meta.url))
const save = (name: string, value: unknown) => writeFile(new URL(`./evidence/unit10-${name}-after.json`, import.meta.url), JSON.stringify(value, null, 2) + '\n')
const delay = (ms: number) => new Promise(r => setTimeout(r, ms))
const alive = (pid: number) => {
  try { process.kill(pid, 0); return true } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false
    throw error
  }
}
const pids = async (path: string) => {
  for (let n = 0; n < 200; n++) { try { return JSON.parse(await readFile(path, 'utf8')) as { child: number; grandchild: number } } catch { await delay(5) } }
  throw new Error('Synthetic child did not report its process IDs')
}

it('characterizes managed subprocess exit acknowledgement and usage descendants', async () => {
  const root = await mkdtemp(join(tmpdir(), 'acorn-perf09-process-'))
  const owned: number[] = [], results: Record<string, unknown> = {}
  try {
    const rpcPid = join(root, 'rpc.json')
    const rpc = new JsonRpcProcess({ command: process.execPath, args: [fixture, 'rpc', rpcPid], cwd: root, env: { PATH: '/usr/bin:/bin' } })
    const hello = await rpc.request<{ child: number; grandchild: number }>('hello')
    owned.push(hello.child, hello.grandchild)
    const start = performance.now(); await rpc.stop()
    const stopWallMs = performance.now() - start
    await delay(150)
    results.rpc = { stopWallMs, markedClosed: rpc.closed, childAlive: alive(hello.child), grandchildAlive: alive(hello.grandchild) }
    expect(alive(hello.child)).toBe(false)
    expect(alive(hello.grandchild)).toBe(false)

    const acpPid = join(root, 'acp.json')
    const driver = new AcpDriver({ id: 'synthetic', profileId: 'synthetic', label: 'Synthetic', spawn: { entry: () => fixture, args: ['acp', acpPid] } })
    const handle = await driver.start({ session: { id: 'synthetic', config: {}, providerSessionRef: null } as any, cwd: root, env: {}, mcpServers: [], noProviderExecutionHistory: true, onEvent: async () => {}, onClosed: () => {} })
    const acp = await pids(acpPid); owned.push(acp.child, acp.grandchild)
    let settled = false
    const stopping = handle.stop().then(() => { settled = true })
    await delay(150)
    results.acp = { stopSettledAt150Ms: settled, childAlive: alive(acp.child), grandchildAlive: alive(acp.grandchild) }
    expect(settled).toBe(false)
    expect(alive(acp.child)).toBe(true)
    await stopping
    results.acp = { ...results.acp as object, childAliveAfterStop: alive(acp.child), grandchildAliveAfterStop: alive(acp.grandchild) }
    expect(alive(acp.child)).toBe(false)
    expect(alive(acp.grandchild)).toBe(false)

    const startOptions = { session: { id: 'synthetic', config: {}, providerSessionRef: null } as any, cwd: root, env: {}, mcpServers: [], noProviderExecutionHistory: true, onEvent: async () => {}, onClosed: () => {} }
    const acpFailPid = join(root, 'acp-fail.json')
    const failingAcp = new AcpDriver({ id: 'synthetic', profileId: 'synthetic', label: 'Synthetic', spawn: { entry: () => fixture, args: ['acp-fail', acpFailPid] } })
    await expect(failingAcp.start(startOptions)).rejects.toThrow('synthetic handshake rejected')
    const acpFailed = await pids(acpFailPid); owned.push(acpFailed.child, acpFailed.grandchild)
    results.acpFailedStart = { childAliveAfterRejection: alive(acpFailed.child), grandchildAliveAfterRejection: alive(acpFailed.grandchild) }
    expect(alive(acpFailed.child)).toBe(false)
    expect(alive(acpFailed.grandchild)).toBe(false)

    const codexFailPid = join(root, 'codex-fail.json'), fakeCodex = join(root, 'codex')
    const shellQuote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'"
    await writeFile(fakeCodex, `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(fixture)} codex-fail ${shellQuote(codexFailPid)} "$@"\n`, { mode: 0o700 })
    const savedPath = process.env.PATH
    try {
      process.env.PATH = `${root}:/usr/bin:/bin`
      await expect(new CodexAgentDriver().start(startOptions)).rejects.toThrow('synthetic handshake rejected')
    } finally { process.env.PATH = savedPath }
    const codexFailed = await pids(codexFailPid); owned.push(codexFailed.child, codexFailed.grandchild)
    results.codexFailedStart = { childAliveAfterRejection: alive(codexFailed.child), grandchildAliveAfterRejection: alive(codexFailed.grandchild), executable: 'disposable fake codex' }
    expect(alive(codexFailed.child)).toBe(false)
    expect(alive(codexFailed.grandchild)).toBe(false)

    const ptyPid = join(root, 'pty.json')
    const capture = capturePty({ command: process.execPath, args: [fixture, 'pty', ptyPid], cwd: root, env: { PATH: '/usr/bin:/bin' }, idleMs: 10, timeoutMs: 5000, killEscalationMs: 30 })
    const pty = await pids(ptyPid); owned.push(pty.child, pty.grandchild)
    await capture; await delay(150)
    results.pty = { childAliveAfterEscalation: alive(pty.child), grandchildAliveAfterEscalation: alive(pty.grandchild), killEscalationMs: 30 }
    expect(alive(pty.child)).toBe(false)
    expect(alive(pty.grandchild)).toBe(false)
  } finally {
    for (let n = 0; n < 200 && owned.some(alive); n++) await delay(5)
    const remainingAlive = owned.filter(alive)
    results.cleanup = { ownedProcesses: owned.length, explicitSigkillAttempts: 0, ownedPids: owned, remainingAlive: remainingAlive.length }
    await save('process', results)
    await rm(root, { recursive: true, force: true })
    expect(remainingAlive).toHaveLength(0)
  }
})
