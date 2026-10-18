import { randomUUID } from 'node:crypto'
import type { ChildProcess } from 'node:child_process'
import { chmodSync, closeSync, existsSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { NodeBroker } from '@acorn/custody/broker'
import { probeNode } from '@acorn/custody/broker/nodePairing.ts'
import {
  custody,
  dataRootDir,
  launchNode,
  NodeStartTimeout,
  requestNodeStop,
  runningNode,
  type LaunchedNode,
  type NodeHandshake,
} from '@acorn/custody/local'
import { LOCAL_TOKEN_SCOPE } from '@acorn/custody/custody/deviceTokenStore.ts'
import { lockedBy } from '@acorn/node-core/server/storage'
import { NODE_PROTOCOL_VERSION, NODE_RESTART_EXIT_CODE, nodeInfoSchema } from '@acorn/protocol/node.ts'
import { CliError } from '../error'
import { standaloneEntry } from './entry'
import {
  canonicalRoot,
  clearServiceRecord,
  prepareServiceDir,
  readServiceRecord,
  servicePaths,
  writeServiceRecord,
  type ServiceRecord,
} from './record'

const START_TIMEOUT_MS = 120_000
const STOP_TIMEOUT_MS = 40_000 // Node drain is bounded at 30 seconds.
const POLL_MS = 150

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
  apiVersion: 'acorn.cli/v1',
  kind: 'NodeService',
  state,
  nodeId: null,
  pid: null,
  endpoint: null,
  protocolVersion: null,
  healthy: false,
  logPath: null,
  ...partial,
})

async function authenticatedInfo(
  record: Pick<ServiceRecord, 'nodeId' | 'endpoint' | 'fingerprint'> & { certPem: string },
  token: string,
) {
  const broker = new NodeBroker({ frame() {}, bytes() {}, status() {} })
  broker.upsert({ ...record, label: 'This computer', local: true, token })
  try {
    const response = await broker.fetch(record.nodeId, {
      requestId: randomUUID(),
      path: '/v1/node',
      method: 'GET',
      headers: {},
      timeoutMs: 4_000,
    })
    if (response.status !== 200) return null
    const parsed = nodeInfoSchema.safeParse(JSON.parse(new TextDecoder().decode(response.body)))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  } finally {
    broker.dispose()
  }
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
    } catch {
      /* no claim */
    }
    return status('stopped')
  }
  let running: ReturnType<typeof runningNode>
  try {
    running = runningNode(root)
  } catch {
    return status('starting', { pid, logPath: record?.logPath ?? null })
  }
  if (!running) return status('starting', { pid, logPath: record?.logPath ?? null })
  let probe: Awaited<ReturnType<typeof probeNode>>
  try {
    probe = await probeNode(running.endpoint)
  } catch {
    return status('starting', {
      pid,
      nodeId: running.nodeId,
      endpoint: running.endpoint,
      logPath: record?.logPath ?? null,
    })
  }
  if (probe.fingerprint !== running.fingerprint || !probe.compatible) {
    return status('running-unowned', {
      pid,
      nodeId: running.nodeId,
      endpoint: running.endpoint,
      protocolVersion: probe.protocolVersion,
    })
  }
  const visible = {
    pid,
    nodeId: running.nodeId,
    endpoint: running.endpoint,
    protocolVersion: probe.protocolVersion,
    healthy: true,
  }
  if (
    !record ||
    record.pid !== pid ||
    record.nodeId !== running.nodeId ||
    record.endpoint !== running.endpoint ||
    record.fingerprint !== running.fingerprint
  ) {
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
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

async function acquireClaim(path: string): Promise<void> {
  const deadline = Date.now() + START_TIMEOUT_MS
  for (;;) {
    try {
      const fd = openSync(path, 'wx', 0o600)
      try {
        writeFileSync(fd, `${process.pid}\n`)
        chmodSync(path, 0o600)
      } finally {
        closeSync(fd)
      }
      return
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      let holder = 0
      try {
        holder = Number(readFileSync(path, 'utf8').trim())
      } catch {
        /* torn claim */
      }
      if (!holder || !processAlive(holder)) {
        rmSync(path, { force: true })
        continue
      }
      if (Date.now() >= deadline)
        throw new CliError('node_start_timeout', 'Another CLI start still owns the startup claim.', 5)
      await delay(POLL_MS)
    }
  }
}

// Without `log`, the Node writes to this process's own stdout and stderr, as a foreground Node does.
function launch(
  root: string,
  instanceId: string,
  detached: boolean,
  previousToken: string | undefined,
  log?: { path: string; fd: number },
): LaunchedNode {
  const launched = launchNode({
    entry: standaloneEntry(),
    dataDir: root,
    previousToken,
    env: {
      ACORN_CLI_SERVICE_ID: instanceId,
      ACORN_CLI_LOG_PATH: log?.path,
      ACORN_ADVERTISE_HOST: undefined,
    },
    // The log's fd captures module-load failures before the entry can install its bounded logger.
    // Normal logs are intercepted by that logger after imports finish.
    stdout: log?.fd ?? 1,
    stderr: log?.fd ?? 2,
    detached,
  })
  if (detached) launched.child.unref()
  const handshake = launched.handshake.catch((error: unknown) => {
    if (error instanceof NodeStartTimeout) throw new CliError('node_start_timeout', error.message, 5)
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(log ? `${message} See ${log.path}.` : message)
  })
  return { child: launched.child, handshake }
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
  return (await startService(canonicalRoot(root), { foreground: false, logPath: servicePaths(root).log })).status
}

type ServiceStart = {
  foreground: boolean
  // Background mode always logs to the service's file. Foreground mode logs to one only with --log.
  logPath?: string
  // Called once the child exists, before its handshake, so a foreground launcher can forward a stop.
  onSpawn?: (child: ChildProcess) => void
}

// Only the status when another Node already holds the root.
type Started =
  | { status: ServiceStatus }
  | { status: ServiceStatus; child: ChildProcess; handshake: NodeHandshake; instanceId: string }

async function startService(root: string, start: ServiceStart): Promise<Started> {
  const paths = servicePaths(root)
  prepareServiceDir(paths.dir)
  await acquireClaim(paths.claim)
  let child: ChildProcess | undefined
  try {
    const existing = await nodeServiceStatus(root)
    if (existing.state === 'running' || existing.state === 'running-unowned') return { status: existing }
    if (existing.state === 'starting' && existing.pid !== process.pid)
      throw new CliError('node_starting', `A Node is starting for ${root}.`, 4)
    const instanceId = randomUUID()
    const previousToken = custody().tokens.read(LOCAL_TOKEN_SCOPE)
    let launched: ReturnType<typeof launch>
    if (start.logPath) {
      // Create the restricted log before spawning; early boot errors have somewhere to go.
      const logFd = openSync(start.logPath, 'a', 0o600)
      chmodSync(start.logPath, 0o600)
      try {
        launched = launch(root, instanceId, !start.foreground, previousToken, { path: start.logPath, fd: logFd })
      } finally {
        closeSync(logFd)
      }
    } else launched = launch(root, instanceId, !start.foreground, previousToken)
    child = launched.child
    start.onSpawn?.(child)
    const handshake = await launched.handshake
    const probe = await probeNode(handshake.endpoint)
    if (
      probe.fingerprint !== handshake.fingerprint ||
      !probe.compatible ||
      probe.protocolVersion !== NODE_PROTOCOL_VERSION
    ) {
      throw new CliError('identity_mismatch', 'The started Node presented an unexpected identity or protocol.', 3)
    }
    const info = await authenticatedInfo({ ...handshake, certPem: probe.certPem }, handshake.deviceToken)
    if (info?.nodeId !== handshake.nodeId || info.serviceInstanceId !== instanceId || lockedBy(root) !== child.pid) {
      throw new CliError(
        'node_start_failed',
        'The Node did not pass its authenticated readiness and ownership check.',
        3,
      )
    }
    const { fleet, tokens } = custody()
    fleet.remember(
      {
        nodeId: handshake.nodeId,
        label: 'This computer',
        local: true,
        endpoint: handshake.endpoint,
        fingerprint: handshake.fingerprint,
        certPem: probe.certPem,
      },
      handshake.deviceToken,
    )
    if (tokens.read(LOCAL_TOKEN_SCOPE) !== handshake.deviceToken) {
      throw new CliError(
        'custody_unavailable',
        'The Node started, but its device token could not be saved to private custody.',
        3,
      )
    }
    const record: ServiceRecord = {
      root: canonicalRoot(root),
      pid: child.pid!,
      instanceId,
      nodeId: handshake.nodeId,
      endpoint: handshake.endpoint,
      fingerprint: handshake.fingerprint,
      logPath: start.logPath ?? null,
      startedAt: Date.now(),
      ...(start.foreground ? { foreground: true } : {}),
    }
    writeServiceRecord(paths.record, record)
    child.stdio[3]?.destroy()
    const running = status('running', {
      nodeId: record.nodeId,
      pid: record.pid,
      endpoint: record.endpoint,
      protocolVersion: NODE_PROTOCOL_VERSION,
      healthy: true,
      logPath: record.logPath,
    })
    return { status: running, child, handshake, instanceId }
  } catch (error) {
    if (child) await discardFailedLaunch(child)
    throw error
  } finally {
    rmSync(paths.claim, { force: true })
  }
}

export async function stopNodeService(force = false, root = dataRootDir(), restart = false): Promise<ServiceStatus> {
  root = canonicalRoot(root)
  const current = await nodeServiceStatus(root)
  if (current.state === 'stopped') return current
  if (current.state !== 'running' || !current.pid)
    throw new CliError('node_not_owned', 'This CLI does not own the running Node for this data root.', 4)
  const paths = servicePaths(root)
  const record = readServiceRecord(paths.record, root)
  if (!record || record.pid !== current.pid || lockedBy(root) !== current.pid)
    throw new CliError('node_not_owned', 'Node ownership changed before stop.', 4)
  if (force) process.kill(current.pid, 'SIGKILL')
  else if (!(await askToDrain(root, restart))) {
    // A signal can't ask for a restart, and Windows ends a process outright for SIGTERM, skipping the drain.
    if (restart) throw new CliError('node_restart_refused', `Node ${current.pid} did not take the restart request.`, 4)
    if (process.platform === 'win32')
      throw new CliError(
        'node_stop_refused',
        `Node ${current.pid} did not take the stop request. Run acorn node stop --force to end it without a drain.`,
        4,
      )
    process.kill(current.pid, 'SIGTERM')
  }
  const deadline = Date.now() + STOP_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (lockedBy(root) !== current.pid || !processAlive(current.pid)) {
      clearServiceRecord(paths.record, record.instanceId)
      return status('stopped')
    }
    await delay(POLL_MS)
  }
  const see = record.logPath ? `see ${record.logPath}` : "see the Node's output"
  throw new CliError('node_stop_timeout', `Node ${current.pid} did not finish draining; ${see}.`, 5)
}

async function askToDrain(root: string, restart: boolean): Promise<boolean> {
  const token = custody().tokens.read(LOCAL_TOKEN_SCOPE)
  const running = runningNode(root)
  return Boolean(token && running && (await requestNodeStop(running, token, restart)))
}

/** A foreground Node restarts inside its launcher, so a service manager sees no exit. A background one
 *  has no launcher left, so it's stopped and started again. */
export async function restartNodeService(root = dataRootDir()): Promise<ServiceStatus> {
  root = canonicalRoot(root)
  if (!readServiceRecord(servicePaths(root).record, root)?.foreground) {
    await stopNodeService(false, root)
    return startNodeService(root)
  }
  await stopNodeService(false, root, true)
  const deadline = Date.now() + START_TIMEOUT_MS
  while (Date.now() < deadline) {
    const restarted = await nodeServiceStatus(root)
    if (restarted.state === 'running') return restarted
    await delay(POLL_MS)
  }
  throw new CliError('node_start_timeout', 'The Node stopped but its launcher did not start it again.', 5)
}

/** `acorn node start --foreground`: the background start, attached. The Node writes to this process's
 *  stdout and stderr, or to `logPath`, and this process exits with the Node's exit code. Answers the
 *  running Node's status instead when one already holds the root. */
export async function runNodeForeground(logPath?: string, root = dataRootDir()): Promise<ServiceStatus | number> {
  root = canonicalRoot(root)
  let child: ChildProcess | undefined
  let handshake: NodeHandshake | undefined
  let stopping = false
  // The Node drains on either signal and ignores a repeat, so this is safe when a terminal or systemd
  // also signalled it directly. Windows ends a process outright for a signal, so there the drain is
  // asked for over the route.
  const forward = (signal: NodeJS.Signals): void => {
    stopping = true
    if (process.platform === 'win32' && handshake) void requestNodeStop(handshake, handshake.deviceToken)
    else child?.kill(signal)
  }
  process.on('SIGINT', forward)
  process.on('SIGTERM', forward)
  try {
    for (;;) {
      let exited: Promise<number> | undefined
      const started = await startService(root, {
        foreground: true,
        logPath: logPath && resolve(logPath),
        onSpawn(spawned) {
          child = spawned
          exited = new Promise((done) => spawned.once('exit', (code) => done(code ?? 1)))
          // A stop that arrived before the spawn.
          if (stopping) spawned.kill('SIGTERM')
        },
      })
      if (!('child' in started)) return started.status
      handshake = started.handshake
      const code = await exited!
      clearServiceRecord(servicePaths(root).record, started.instanceId)
      // Restart on request only. A crash is the service manager's to restart.
      if (code !== NODE_RESTART_EXIT_CODE || stopping) return code
    }
  } finally {
    process.off('SIGINT', forward)
    process.off('SIGTERM', forward)
  }
}
