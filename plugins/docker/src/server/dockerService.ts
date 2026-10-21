// The stateful docker runtime: an in-memory list cache invalidated by a long-lived `docker events`
// watcher, which also pushes a debounced `docker:changed` frame over the WS hub so every window
// refreshes without polling the daemon. Pure Node, child processes only, constructed lazily on first
// use. Bootstrap disposes it on quit.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import type { WsServerFrame } from '@acorn/protocol/ws.ts'
import type {
  DockerContainerSummary,
  DockerImage,
  DockerInfo,
  DockerNetwork,
  DockerScope,
  DockerVolume,
} from '../shared/model'
import { docker, DockerCliError, dockerEnv, dockerOutput } from './cli'
import {
  eventScope,
  parseImagesOutput,
  parseJsonLines,
  parseNetworksOutput,
  parsePsOutput,
  parseVolumesOutput,
} from './parse'

const INFO_TTL_MS = 10_000
const LIST_TTL_MS = 5_000 // backstop only; the events watcher invalidates eagerly
const SNAPSHOT_REFRESH_MS = 10_000
const SNAPSHOT_FAILURE_MS = 30_000
const BROADCAST_DEBOUNCE_MS = 300
const EVENTS_BACKOFF_MAX_MS = 60_000
const MAX_STREAM_CHILDREN = 32 // Bound concurrent stream readers to protect the local daemon.

type VersionJson = { Client?: { Context?: string }; Server?: { Version?: string } }
type ContainerSnapshot = { at: number; list: DockerContainerSummary[] }

class DockerService {
  constructor(
    private readonly broadcast: (frame: WsServerFrame) => void,
    // Tells the browser extension to read an open Docker panel again (docs/docker.md § Browser panel).
    private readonly status: () => void,
  ) {}
  private infoCache: { at: number; value: DockerInfo } | null = null
  private pendingInfo: Promise<DockerInfo> | null = null
  private lists = new Map<DockerScope, { at: number; data: unknown }>()
  private pending = new Map<DockerScope, Promise<unknown>>()
  private events: ChildProcessWithoutNullStreams | null = null
  private eventsBackoffMs = 1_000
  private eventsRestartTimer: ReturnType<typeof setTimeout> | null = null
  private dirtyScopes = new Set<DockerScope>()
  private snapshot: ContainerSnapshot | null = null
  private snapshotDirty = false
  private snapshotFailure: { at: number; error: unknown } | null = null
  private snapshotLoad: Promise<ContainerSnapshot> | null = null
  private broadcastTimer: ReturnType<typeof setTimeout> | null = null
  private disposed = false

  async info(): Promise<DockerInfo> {
    const cached = this.infoCache
    if (cached && Date.now() - cached.at < INFO_TTL_MS) return cached.value
    if (this.pendingInfo) return this.pendingInfo
    const pending = this.loadInfo()
      .then((value) => {
        if (!this.disposed && this.pendingInfo === pending) {
          this.infoCache = { at: Date.now(), value }
          if (value.available) this.ensureEventsWatcher()
        }
        return value
      })
      .finally(() => {
        if (this.pendingInfo === pending) this.pendingInfo = null
      })
    this.pendingInfo = pending
    return pending
  }

  private async loadInfo(): Promise<DockerInfo> {
    try {
      const out = await docker(['version', '--format', '{{json .}}'], { timeout: 5_000 })
      const parsed = JSON.parse(out) as VersionJson
      return { available: true, version: parsed.Server?.Version ?? 'unknown', context: parsed.Client?.Context ?? null }
    } catch (err) {
      const e = err instanceof DockerCliError ? err : new DockerCliError('failed', String(err))
      return {
        available: false,
        reason: e.kind === 'not_installed' ? 'not_installed' : 'daemon_down',
        detail: e.message,
      }
    }
  }

  async containers(background = false): Promise<DockerContainerSummary[]> {
    return this.cachedList('containers', async () => {
      const out = await docker(['ps', '-a', '--format', '{{json .}}'], { background })
      return parsePsOutput(out)
    })
  }

  async images(): Promise<DockerImage[]> {
    return this.cachedList('images', async () => parseImagesOutput(await docker(['images', '--format', '{{json .}}'])))
  }

  async volumes(): Promise<DockerVolume[]> {
    return this.cachedList('volumes', async () =>
      parseVolumesOutput(await docker(['volume', 'ls', '--format', '{{json .}}'])),
    )
  }

  async networks(): Promise<DockerNetwork[]> {
    return this.cachedList('networks', async () =>
      parseNetworksOutput(await docker(['network', 'ls', '--format', '{{json .}}'])),
    )
  }

  // The container list behind every window's polled task summary. The last good `docker ps` comes back
  // at once and is read again behind it at most every ten seconds, so a daemon that stalls costs the
  // poll no wait. After a docker event the next read waits for a fresh list, because the event is why
  // the windows are asking. A failure is remembered for thirty seconds, and the last good list is served
  // through it. Reads that act on or describe containers use `containers()`, which never serves an old
  // list.
  async containerSnapshot(): Promise<ContainerSnapshot> {
    const now = Date.now()
    const failure =
      this.snapshotFailure && now - this.snapshotFailure.at < SNAPSHOT_FAILURE_MS ? this.snapshotFailure : null
    const last = this.snapshot
    if (last && !this.snapshotDirty) {
      if (!failure && now - last.at >= SNAPSHOT_REFRESH_MS) this.loadSnapshot().catch(() => {})
      return last
    }
    if (failure) {
      if (last) return last
      throw failure.error
    }
    try {
      return await this.loadSnapshot()
    } catch (error) {
      if (last) return last
      throw error
    }
  }

  private loadSnapshot(): Promise<ContainerSnapshot> {
    if (this.snapshotLoad) return this.snapshotLoad
    const load: Promise<ContainerSnapshot> = this.containers(true).then(
      // A load that an invalidation or disposal replaced answers its own callers and remembers nothing.
      (list) => {
        const snapshot = { at: Date.now(), list }
        if (this.snapshotLoad === load) {
          this.snapshotLoad = null
          this.snapshot = snapshot
          this.snapshotDirty = false
          this.snapshotFailure = null
        }
        return snapshot
      },
      (error: unknown) => {
        if (this.snapshotLoad === load) {
          this.snapshotLoad = null
          this.snapshotFailure = { at: Date.now(), error }
        }
        throw error
      },
    )
    this.snapshotLoad = load
    return load
  }

  // Mutations bypass the cache and dirty it immediately. The events watcher confirms shortly after,
  // but an eager invalidate keeps the UI honest if events lag.
  invalidate(scope: DockerScope): void {
    this.lists.delete(scope)
    this.pending.delete(scope)
    if (scope !== 'containers') return
    this.snapshotDirty = true
    this.snapshotLoad = null
  }

  private async cachedList<T>(scope: DockerScope, load: () => Promise<T>): Promise<T> {
    const hit = this.lists.get(scope)
    if (hit && Date.now() - hit.at < LIST_TTL_MS) return hit.data as T
    const inflight = this.pending.get(scope)
    if (inflight) return inflight as Promise<T>
    this.ensureEventsWatcher()
    const p = load()
      .then((data) => {
        if (!this.disposed && this.pending.get(scope) === p) this.lists.set(scope, { at: Date.now(), data })
        return data
      })
      .finally(() => {
        if (this.pending.get(scope) === p) this.pending.delete(scope)
      })
    this.pending.set(scope, p)
    return p
  }

  private ensureEventsWatcher(): void {
    if (this.disposed || this.events || this.eventsRestartTimer) return
    let child: ChildProcessWithoutNullStreams
    try {
      child = spawn('docker', ['events', '--format', '{{json .}}'], { env: dockerEnv() })
    } catch {
      return this.scheduleEventsRestart()
    }
    this.events = child
    let buffer = ''
    child.stdout.on('data', (chunk: Buffer) => {
      if (this.disposed || this.events !== child) return
      // A steady stream of events means the watcher is healthy, so reset the restart backoff.
      this.eventsBackoffMs = 1_000
      buffer += chunk.toString('utf8')
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of parseJsonLines<unknown>(lines.join('\n'))) {
        const scope = eventScope(line)
        if (scope) this.markDirty(scope)
      }
    })
    child.stderr.on('data', () => {})
    const retire = () => {
      if (this.events !== child) return
      this.events = null
      this.infoCache = null
      this.pendingInfo = null
      this.scheduleEventsRestart()
    }
    child.on('error', retire)
    child.on('close', retire)
  }

  private scheduleEventsRestart(): void {
    if (this.disposed || this.eventsRestartTimer) return
    this.eventsRestartTimer = setTimeout(() => {
      this.eventsRestartTimer = null
      this.ensureEventsWatcher()
    }, this.eventsBackoffMs)
    this.eventsBackoffMs = Math.min(this.eventsBackoffMs * 2, EVENTS_BACKOFF_MAX_MS)
  }

  private markDirty(scope: DockerScope): void {
    if (this.disposed) return
    this.invalidate(scope)
    this.dirtyScopes.add(scope)
    if (this.broadcastTimer) return
    this.broadcastTimer = setTimeout(() => {
      this.broadcastTimer = null
      const scopes = [...this.dirtyScopes]
      this.dirtyScopes.clear()
      if (this.disposed || !scopes.length) return
      this.broadcast({ channel: 'docker:changed', scopes })
      if (scopes.includes('containers')) this.status()
    }, BROADCAST_DEBOUNCE_MS)
  }

  // A container's last `lines` lines, read once for the browser panel. Not the log stream, which keeps
  // a child running for its viewers. stdout and stderr come back apart, so both are read with their
  // timestamps, merged in time order, and the timestamps dropped.
  async logTail(ref: string, lines: number): Promise<string[]> {
    const { stdout, stderr } = await dockerOutput(['logs', '--tail', String(lines), '--timestamps', ref], {
      timeout: 10_000,
    })
    return [...stdout.split('\n'), ...stderr.split('\n')]
      .filter(Boolean)
      .sort()
      .slice(-lines)
      .map((line) => line.replace(/^\S+ /, '').replace(/\r$/, ''))
  }

  // ── Log/stats stream children ───────────────────────────────────────────────────────────────
  // One child per open stream, killed on stop() (WS detach/close). Caller owns dedupe/ref-count.
  private streamStops = new Set<() => void>()
  private streams = new Set<ChildProcessWithoutNullStreams>()

  openStream(kind: 'logs' | 'stats', ref: string, onLine: (line: string) => void, onEnd: () => void): { stop(): void } {
    if (this.disposed || this.streams.size >= MAX_STREAM_CHILDREN) {
      return this.rejectedStream(onEnd)
    }
    const args =
      kind === 'logs'
        ? ['logs', '--tail', '300', '--follow', '--timestamps', ref]
        : ['stats', '--format', '{{json .}}', ref]
    let child: ChildProcessWithoutNullStreams
    try {
      child = spawn('docker', args, { env: dockerEnv() })
    } catch {
      return this.rejectedStream(onEnd)
    }
    this.streams.add(child)
    let stopped = false
    let settled = false
    const settle = () => {
      if (settled) return
      settled = true
      this.streams.delete(child)
      this.streamStops.delete(stop)
      if (!stopped) onEnd()
    }
    const stop = () => {
      if (settled) return
      stopped = true
      settle()
      try {
        child.kill('SIGKILL')
      } catch {
        /* Continue retiring sibling children. */
      }
    }
    this.streamStops.add(stop)
    // Logs keep raw chunk text, no line framing needed downstream. Stats are parsed per line, so
    // buffer to line boundaries there. Both stdio streams are log content for `docker logs`.
    let buffer = ''
    const emit = (chunk: Buffer) => {
      if (settled || this.disposed) return
      if (kind === 'logs') return onLine(chunk.toString('utf8'))
      buffer += chunk.toString('utf8')
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) if (line.trim()) onLine(line)
    }
    child.stdout.on('data', emit)
    child.stderr.on('data', emit)
    child.on('error', settle)
    // Exit precedes stdio close. Keep draining stdout/stderr until close.
    child.on('close', settle)
    return { stop }
  }

  private rejectedStream(onEnd: () => void): { stop(): void } {
    let stopped = false
    queueMicrotask(() => {
      if (!stopped) onEnd()
    })
    return {
      stop: () => {
        stopped = true
      },
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.eventsRestartTimer) clearTimeout(this.eventsRestartTimer)
    if (this.broadcastTimer) clearTimeout(this.broadcastTimer)
    const events = this.events
    this.events = null
    try {
      events?.kill('SIGKILL')
    } catch {
      /* Continue disposing owned streams. */
    }
    for (const stop of this.streamStops) stop()
    this.streams.clear()
    this.lists.clear()
    this.pending.clear()
    this.snapshot = null
    this.snapshotFailure = null
    this.snapshotLoad = null
    this.pendingInfo = null
    this.infoCache = null
    this.dirtyScopes.clear()
    this.eventsRestartTimer = null
    this.broadcastTimer = null
  }
}

let service: DockerService | null = null

export function getDockerService(
  broadcast: (frame: WsServerFrame) => void = () => {},
  status: () => void = () => {},
): DockerService {
  if (!service) service = new DockerService(broadcast, status)
  return service
}

export function disposeDocker(): void {
  service?.dispose()
  service = null
}
