import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { chmodSync, closeSync, existsSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import type { Readable, Writable } from 'node:stream'
import { setTimeout as delay } from 'node:timers/promises'
import { NodeBroker } from '@acorn/custody/broker'
import { probeNode } from '@acorn/custody/broker/nodePairing.ts'
import { custody, dataRootDir, runningNode } from '@acorn/custody/local'
import { LOCAL_TOKEN_SCOPE } from '@acorn/custody/custody/deviceTokenStore.ts'
import { lockedBy } from '@acorn/node-core/server/storage'
import { ACORN_BASELINE } from '@acorn/protocol/baseline.ts'
import { NODE_PROTOCOL_VERSION, nodeInfoSchema } from '@acorn/protocol/node.ts'
import { CliError } from '../error'
import { standaloneEntry } from './entry'
import { canonicalRoot, clearServiceRecord, prepareServiceDir, readServiceRecord, servicePaths, writeServiceRecord, type ServiceRecord } from './record'

const START_TIMEOUT_MS = 120_000
const STOP_TIMEOUT_MS = 40_000 // Node drain is bounded at 30 seconds.
const POLL_MS = 150

type Handshake = { baseline: string; protocolVersion: number; nodeId: string; endpoint: string; fingerprint: string; certPem: string; deviceToken: string }
export type ServiceStatus = {
  apiVersion: 'acorn.cli/v1'
  kind: 'NodeService'
  state: 'running' | 'starting' | 'stopped' | 'running-unowned'
  nodeId: string | null
  pid: number | null
  endpoint: string | null
  protocolVersion: number | null
  healthy: boolean
  logPath: string | null
}

const status = (state: ServiceStatus['state'], partial: Partial<ServiceStatus> = {}): ServiceStatus => ({
  apiVersion: 'acorn.cli/v1', kind: 'NodeService', state, nodeId: null, pid: null,
  endpoint: null, protocolVersion: null, healthy: false, logPath: null, ...partial,
})

async function authenticatedInfo(record: Pick<ServiceRecord, 'nodeId' | 'endpoint' | 'fingerprint'> & { certPem: string }, token: string) {
  const broker = new NodeBroker({ frame() {}, bytes() {}, status() {} })
  broker.upsert({ ...record, label: 'This computer', local: true, token })
  try {
    const response = await broker.fetch(record.nodeId, { requestId: randomUUID(), path: '/v1/node', method: 'GET', headers: {}, timeoutMs: 4_000 })
    if (response.status !== 200) return null
    const parsed = nodeInfoSchema.safeParse(JSON.parse(new TextDecoder().decode(response.body)))
    return parsed.success ? parsed.data : null
  } catch { return null }
  finally { broker.dispose() }
}

export async function nodeServiceStatus(root = dataRootDir()): Promise<ServiceStatus> {
  root = canonicalRoot(root)
  const paths = servicePaths(root)
  const record = readServiceRecord(paths.record, root)
  const pid = lockedBy(root)
  if (pid === null) {
    if (record) clearServiceRecord(paths.record, record.instanceId)
    else if (existsSync(paths.record)) rmSync(paths.record, { force: true })
    try {
      const claimant = Number(readFileSync(paths.claim, 'utf8').trim())
      if (claimant > 0 && processAlive(claimant)) return status('starting', { pid: claimant, logPath: paths.log })
    } catch { /* no claim */ }
    return status('stopped')
  }
  let running: ReturnType<typeof runningNode>
  try { running = runningNode(root) } catch { return status('starting', { pid, logPath: record?.logPath ?? null }) }
  if (!running) return status('starting', { pid, logPath: record?.logPath ?? null })
  let probe: Awaited<ReturnType<typeof probeNode>>
  try { probe = await probeNode(running.endpoint) }
  catch { return status('starting', { pid, nodeId: running.nodeId, endpoint: running.endpoint, logPath: record?.logPath ?? null }) }
  if (probe.fingerprint !== running.fingerprint || !probe.compatible) {
    return status('running-unowned', { pid, nodeId: running.nodeId, endpoint: running.endpoint, protocolVersion: probe.protocolVersion })
  }
  const visible = { pid, nodeId: running.nodeId, endpoint: running.endpoint, protocolVersion: probe.protocolVersion, healthy: true }
  if (!record || record.pid !== pid || record.nodeId !== running.nodeId || record.endpoint !== running.endpoint || record.fingerprint !== running.fingerprint) {
    if (record) clearServiceRecord(paths.record, record.instanceId)
    return status('running-unowned', visible)
  }
  const token = custody().tokens.read(LOCAL_TOKEN_SCOPE)
  const info = token ? await authenticatedInfo({ ...record, certPem: running.certPem }, token) : null
  if (info?.nodeId !== record.nodeId || info.serviceInstanceId !== record.instanceId) {
    // A matching PID is not ownership: it can be reused after a crash, or a different host can
    // reopen the same root with its stable nodeId and certificate.
    return status('running-unowned', visible)
  }
  return status('running', { ...visible, logPath: record.logPath })
}

function processAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true }
  catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM' }
}

async function acquireClaim(path: string): Promise<void> {
  const deadline = Date.now() + START_TIMEOUT_MS
  for (;;) {
    try {
      const fd = openSync(path, 'wx', 0o600)
      try { writeFileSync(fd, `${process.pid}\n`); chmodSync(path, 0o600) }
      finally { closeSync(fd) }
      return
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      let holder = 0
      try { holder = Number(readFileSync(path, 'utf8').trim()) } catch { /* torn claim */ }
      if (!holder || !processAlive(holder)) { rmSync(path, { force: true }); continue }
      if (Date.now() >= deadline) throw new CliError('node_start_timeout', 'Another CLI start still owns the startup claim.', 5)
      await delay(POLL_MS)
    }
  }
}

function launch(root: string, logPath: string, logFd: number, instanceId: string, previousToken?: string): { child: ChildProcess; handshake: Promise<Handshake> } {
  const entry = standaloneEntry()
  const child = spawn(entry.command, entry.args, {
    ...(entry.cwd ? { cwd: entry.cwd } : {}), detached: true,
    env: { ...process.env, ACORN_DATA_DIR: root, ACORN_CLI_BACKGROUND: '1', ACORN_CLI_SERVICE_ID: instanceId,
      ACORN_CLI_LOG_PATH: logPath, ACORN_DEVICE_TOKEN: undefined, ACORN_ADVERTISE_HOST: undefined },
    // The inherited fd captures module-load failures before the entry can install its bounded
    // logger. Normal logs are intercepted by that logger after imports finish.
    stdio: ['ignore', logFd, logFd, 'pipe', 'pipe'],
  })
  child.unref()
  // fd 4 carries the prior credential into the child. Empty means mint a new device. It is never
  // an argument, environment variable, or log line.
  ;(child.stdio[4] as Writable | null)?.end(`${previousToken ?? ''}\n`)
  const handshake = new Promise<Handshake>((resolve, reject) => {
    const timer = setTimeout(() => reject(new CliError('node_start_timeout', 'The Node did not become ready before the startup deadline.', 5)), START_TIMEOUT_MS)
    const lines = createInterface({ input: child.stdio[3] as Readable })
    lines.once('line', (line) => {
      clearTimeout(timer)
      try {
        const parsed = JSON.parse(line) as Partial<Handshake>
        if (parsed.baseline !== ACORN_BASELINE || parsed.protocolVersion !== NODE_PROTOCOL_VERSION ||
          !parsed.nodeId || !parsed.endpoint || !parsed.fingerprint || !parsed.certPem || !parsed.deviceToken) throw new Error('Invalid private Node handshake')
        resolve(parsed as Handshake)
      } catch (error) { reject(error) }
      lines.close()
    })
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Node exited before readiness (code ${code}); see ${logPath}.`)) })
    child.once('error', (error) => { clearTimeout(timer); reject(error) })
  })
  return { child, handshake }
}

async function discardFailedLaunch(child: ChildProcess): Promise<void> {
  if (child.pid && child.exitCode === null && child.signalCode === null) {
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
    child.kill('SIGTERM')
    await Promise.race([exited, delay(5_000)])
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  }
  child.stdio[3]?.destroy()
  child.stdio[4]?.destroy()
}

export async function startNodeService(root = dataRootDir()): Promise<ServiceStatus> {
  root = canonicalRoot(root)
  const paths = servicePaths(root)
  prepareServiceDir(paths.dir)
  await acquireClaim(paths.claim)
  let child: ChildProcess | undefined
  try {
    const existing = await nodeServiceStatus(root)
    if (existing.state === 'running' || existing.state === 'running-unowned') return existing
    if (existing.state === 'starting' && existing.pid !== process.pid) throw new CliError('node_starting', `A Node is starting for ${root}.`, 4)
    const instanceId = randomUUID()
    const previousToken = custody().tokens.read(LOCAL_TOKEN_SCOPE)
    // Create the restricted log before spawning; early boot errors have somewhere to go.
    const logFd = openSync(paths.log, 'a', 0o600)
    chmodSync(paths.log, 0o600)
    let launched: ReturnType<typeof launch>
    try { launched = launch(root, paths.log, logFd, instanceId, previousToken) }
    finally { closeSync(logFd) }
    child = launched.child
    const handshake = await launched.handshake
    const probe = await probeNode(handshake.endpoint)
    if (probe.fingerprint !== handshake.fingerprint || !probe.compatible || probe.protocolVersion !== NODE_PROTOCOL_VERSION) {
      throw new CliError('identity_mismatch', 'The started Node presented an unexpected identity or protocol.', 3)
    }
    const info = await authenticatedInfo({ ...handshake, certPem: probe.certPem }, handshake.deviceToken)
    if (info?.nodeId !== handshake.nodeId || info.serviceInstanceId !== instanceId || lockedBy(root) !== child.pid) {
      throw new CliError('node_start_failed', 'The Node did not pass its authenticated readiness and ownership check.', 3)
    }
    const { fleet, tokens } = custody()
    fleet.remember({ nodeId: handshake.nodeId, label: 'This computer', local: true, endpoint: handshake.endpoint,
      fingerprint: handshake.fingerprint, certPem: probe.certPem }, handshake.deviceToken)
    if (tokens.read(LOCAL_TOKEN_SCOPE) !== handshake.deviceToken) {
      throw new CliError('custody_unavailable', 'The Node started, but its device token could not be saved to private custody.', 3)
    }
    const record: ServiceRecord = { root: canonicalRoot(root), pid: child.pid!, instanceId,
      nodeId: handshake.nodeId, endpoint: handshake.endpoint, fingerprint: handshake.fingerprint,
      logPath: paths.log, startedAt: Date.now() }
    writeServiceRecord(paths.record, record)
    child.stdio[3]?.destroy()
    return status('running', { nodeId: record.nodeId, pid: record.pid, endpoint: record.endpoint,
      protocolVersion: NODE_PROTOCOL_VERSION, healthy: true, logPath: record.logPath })
  } catch (error) {
    if (child) await discardFailedLaunch(child)
    throw error
  } finally {
    rmSync(paths.claim, { force: true })
  }
}

export async function stopNodeService(force = false, root = dataRootDir()): Promise<ServiceStatus> {
  root = canonicalRoot(root)
  const current = await nodeServiceStatus(root)
  if (current.state === 'stopped') return current
  if (current.state !== 'running' || !current.pid) throw new CliError('node_not_owned', 'This CLI does not own the running Node for this data root.', 4)
  const paths = servicePaths(root)
  const record = readServiceRecord(paths.record, root)
  if (!record || record.pid !== current.pid || lockedBy(root) !== current.pid) throw new CliError('node_not_owned', 'Node ownership changed before stop.', 4)
  process.kill(current.pid, force ? 'SIGKILL' : 'SIGTERM')
  const deadline = Date.now() + STOP_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (lockedBy(root) !== current.pid || !processAlive(current.pid)) {
      clearServiceRecord(paths.record, record.instanceId)
      return status('stopped')
    }
    await delay(POLL_MS)
  }
  throw new CliError('node_stop_timeout', `Node ${current.pid} did not finish draining; see ${record.logPath}.`, 5)
}
