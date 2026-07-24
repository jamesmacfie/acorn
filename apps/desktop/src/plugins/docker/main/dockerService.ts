// The stateful docker runtime: an in-memory list cache invalidated by a long-lived `docker events`
// watcher, which also pushes a debounced `docker:changed` frame over the WS hub so every window
// refreshes without polling the daemon. Pure Node (child processes only) — constructed lazily on
// first use, so it works under both the Electron root and dev:node; bootstrap disposes it on quit.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { wsBroadcast } from '../../../core/main/wsHub'
import type { DockerContainerSummary, DockerImage, DockerInfo, DockerNetwork, DockerScope, DockerVolume } from '../shared/model'
import { docker, DockerCliError, dockerEnv } from './cli'
import { eventScope, parseImagesOutput, parseJsonLines, parseNetworksOutput, parsePsOutput, parseVolumesOutput } from './parse'

const INFO_TTL_MS = 10_000
const LIST_TTL_MS = 5_000 // backstop only; the events watcher invalidates eagerly
const BROADCAST_DEBOUNCE_MS = 300
const EVENTS_BACKOFF_MAX_MS = 60_000
const MAX_STREAM_CHILDREN = 32 // ponytail: hard cap; raise if someone genuinely tails 32 streams

type VersionJson = { Client?: { Context?: string }; Server?: { Version?: string } }

class DockerService {
  private infoCache: { at: number; value: DockerInfo } | null = null
  private lists = new Map<DockerScope, { at: number; data: unknown }>()
  private pending = new Map<DockerScope, Promise<unknown>>()
  private events: ChildProcessWithoutNullStreams | null = null
  private eventsBackoffMs = 1_000
  private eventsRestartTimer: ReturnType<typeof setTimeout> | null = null
  private dirtyScopes = new Set<DockerScope>()
  private broadcastTimer: ReturnType<typeof setTimeout> | null = null
  private disposed = false

  async info(): Promise<DockerInfo> {
    const cached = this.infoCache
    if (cached && Date.now() - cached.at < INFO_TTL_MS) return cached.value
    let value: DockerInfo
    try {
      const out = await docker(['version', '--format', '{{json .}}'], { timeout: 5_000 })
      const parsed = JSON.parse(out) as VersionJson
      value = { available: true, version: parsed.Server?.Version ?? 'unknown', context: parsed.Client?.Context ?? null }
    } catch (err) {
      const e = err instanceof DockerCliError ? err : new DockerCliError('failed', String(err))
      value = { available: false, reason: e.kind === 'not_installed' ? 'not_installed' : 'daemon_down', detail: e.message }
    }
    this.infoCache = { at: Date.now(), value }
    if (value.available) this.ensureEventsWatcher()
    return value
  }

  async containers(): Promise<DockerContainerSummary[]> {
    return this.cachedList('containers', async () => {
      const out = await docker(['ps', '-a', '--format', '{{json .}}'])
      return parsePsOutput(out)
    })
  }

  async images(): Promise<DockerImage[]> {
    return this.cachedList('images', async () => parseImagesOutput(await docker(['images', '--format', '{{json .}}'])))
  }

  async volumes(): Promise<DockerVolume[]> {
    return this.cachedList('volumes', async () => parseVolumesOutput(await docker(['volume', 'ls', '--format', '{{json .}}'])))
  }

  async networks(): Promise<DockerNetwork[]> {
    return this.cachedList('networks', async () => parseNetworksOutput(await docker(['network', 'ls', '--format', '{{json .}}'])))
  }

  // Mutations bypass the cache and dirty it immediately — the events watcher confirms shortly after,
  // but an eager invalidate keeps the UI honest if events lag.
  invalidate(scope: DockerScope): void {
    this.lists.delete(scope)
  }

  private async cachedList<T>(scope: DockerScope, load: () => Promise<T>): Promise<T> {
    const hit = this.lists.get(scope)
    if (hit && Date.now() - hit.at < LIST_TTL_MS) return hit.data as T
    const inflight = this.pending.get(scope)
    if (inflight) return inflight as Promise<T>
    this.ensureEventsWatcher()
    const p = load()
      .then((data) => {
        this.lists.set(scope, { at: Date.now(), data })
        return data
      })
      .finally(() => this.pending.delete(scope))
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
      // A steady stream of events means the watcher is healthy — reset the restart backoff.
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
    child.on('error', () => {})
    child.on('exit', () => {
      if (this.events === child) this.events = null
      this.infoCache = null // the daemon likely went away; re-probe on next info()
      this.scheduleEventsRestart()
    })
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
    this.invalidate(scope)
    this.dirtyScopes.add(scope)
    if (this.broadcastTimer) return
    this.broadcastTimer = setTimeout(() => {
      this.broadcastTimer = null
      const scopes = [...this.dirtyScopes]
      this.dirtyScopes.clear()
      if (scopes.length) wsBroadcast({ channel: 'docker:changed', scopes })
    }, BROADCAST_DEBOUNCE_MS)
  }

  // ── Log/stats stream children ───────────────────────────────────────────────────────────────
  // One child per open stream, killed on stop() (WS detach/close). Caller owns dedupe/ref-count.
  private streams = new Set<ChildProcessWithoutNullStreams>()

  openStream(kind: 'logs' | 'stats', ref: string, onLine: (line: string) => void, onEnd: () => void): { stop(): void } {
    if (this.disposed || this.streams.size >= MAX_STREAM_CHILDREN) {
      queueMicrotask(onEnd)
      return { stop: () => {} }
    }
    const args = kind === 'logs'
      ? ['logs', '--tail', '300', '--follow', '--timestamps', ref]
      : ['stats', '--format', '{{json .}}', ref]
    const child = spawn('docker', args, { env: dockerEnv() })
    this.streams.add(child)
    let stopped = false
    // Logs keep raw chunk text (no line framing needed downstream); stats are parsed per line, so
    // buffer to line boundaries there. Both stdio streams are log content for `docker logs`.
    let buffer = ''
    const emit = (chunk: Buffer) => {
      if (stopped) return
      if (kind === 'logs') return onLine(chunk.toString('utf8'))
      buffer += chunk.toString('utf8')
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) if (line.trim()) onLine(line)
    }
    child.stdout.on('data', emit)
    child.stderr.on('data', emit)
    child.on('error', () => {})
    child.on('exit', () => {
      this.streams.delete(child)
      if (!stopped) onEnd()
    })
    return {
      stop: () => {
        stopped = true
        this.streams.delete(child)
        child.kill('SIGKILL')
      },
    }
  }

  dispose(): void {
    this.disposed = true
    if (this.eventsRestartTimer) clearTimeout(this.eventsRestartTimer)
    if (this.broadcastTimer) clearTimeout(this.broadcastTimer)
    this.events?.kill('SIGKILL')
    this.events = null
    for (const child of this.streams) child.kill('SIGKILL')
    this.streams.clear()
    this.lists.clear()
  }
}

let service: DockerService | null = null

export function getDockerService(): DockerService {
  if (!service) service = new DockerService()
  return service
}

export function disposeDocker(): void {
  service?.dispose()
  service = null
}
