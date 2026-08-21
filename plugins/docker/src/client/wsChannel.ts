// Docker's half of the WebSocket, moved out of @acorn/client-core/wsClient.ts.
//
// It was thirteen lines of a flat if/else in core plus four module-level subscriber maps plus a
// reconnect loop that knew how to spell `docker:${kind}:attach`. Core now owns the envelope and
// routes on the `docker` prefix (@acorn/client-core/wsChannels.ts). Everything below, the maps,
// the payload narrowing, and the reattach set, belongs to this plugin.
import { registerWsChannel, wsConnect, wsSend } from '@acorn/plugin-api/client'
import type { DockerServerFrame, DockerStatsSample } from '../shared/wsFrames'

const dockerChangedSubs = new Set<(scopes: string[]) => void>()
// Log/stats stream subscribers, keyed `${kind}:${id}`: the first-attach / last-detach contract,
// and the set the reconnect reattach below is computed from.
export type DockerStreamEvent = { kind: 'log'; data: string } | { kind: 'stats'; sample: DockerStatsSample } | { kind: 'end' }
const dockerStreamSubs = new Map<string, Set<(event: DockerStreamEvent) => void>>()
// Interactive docker-exec PTYs: one listener per execId, and no reconnect reattach. The PTY dies
// with the connection, the pane shows the exit, and the user reopens.
export type DockerExecEvent = { kind: 'out'; data: string } | { kind: 'exit' }
const dockerExecSubs = new Map<string, (event: DockerExecEvent) => void>()

// Docker cache-dirty pings (the docker plugin's event-driven refresh edge).
export function wsOnDockerChanged(cb: (scopes: string[]) => void): () => void {
  dockerChangedSubs.add(cb)
  wsConnect()
  return () => void dockerChangedSubs.delete(cb)
}

const splitStreamKey = (key: string): ['logs' | 'stats', string] => {
  const sep = key.indexOf(':')
  return [key.slice(0, sep) as 'logs' | 'stats', key.slice(sep + 1)]
}

// Open an interactive docker-exec PTY; returns a dispose that kills it. Input/resize ride the
// same socket via the exported senders.
export function wsDockerExecOpen(execId: string, ref: string, cols: number, rows: number, cb: (event: DockerExecEvent) => void): () => void {
  dockerExecSubs.set(execId, cb)
  wsConnect()
  wsSend({ channel: 'docker:exec:open', execId, ref, cols, rows })
  return () => {
    dockerExecSubs.delete(execId)
    wsSend({ channel: 'docker:exec:kill', execId })
  }
}

export function wsDockerExecInput(execId: string, data: string): void {
  wsSend({ channel: 'docker:exec:in', execId, data })
}

export function wsDockerExecResize(execId: string, cols: number, rows: number): void {
  wsSend({ channel: 'docker:exec:resize', execId, cols, rows })
}

// Subscribe to a docker log/stats stream; returns an unsubscribe. First local subscriber per
// (kind, container) attaches, the last detaches: the wsAttach contract.
export function wsDockerAttach(kind: 'logs' | 'stats', id: string, cb: (event: DockerStreamEvent) => void): () => void {
  const key = `${kind}:${id}`
  let set = dockerStreamSubs.get(key)
  const first = !set
  if (!set) {
    set = new Set()
    dockerStreamSubs.set(key, set)
  }
  set.add(cb)
  wsConnect()
  if (first) wsSend({ channel: `docker:${kind}:attach`, id })
  return () => {
    const s = dockerStreamSubs.get(key)
    if (!s) return
    s.delete(cb)
    if (s.size === 0) {
      dockerStreamSubs.delete(key)
      wsSend({ channel: `docker:${kind}:detach`, id })
    }
  }
}

registerWsChannel(
  'docker',
  (rawFrame) => {
    // The one cast, at the front door, against this plugin's own union (../shared/wsFrames.ts).
    const frame = rawFrame as DockerServerFrame
    switch (frame.channel) {
      case 'docker:changed':
        return dockerChangedSubs.forEach((cb) => cb(frame.scopes))
      case 'docker:log':
        return void dockerStreamSubs.get(`logs:${frame.id}`)?.forEach((cb) => cb({ kind: 'log', data: frame.data }))
      case 'docker:stats':
        return void dockerStreamSubs.get(`stats:${frame.id}`)?.forEach((cb) => cb({ kind: 'stats', sample: frame.sample }))
      case 'docker:stream-end':
        return void dockerStreamSubs.get(`${frame.kind}:${frame.id}`)?.forEach((cb) => cb({ kind: 'end' }))
      case 'docker:exec:out':
        return dockerExecSubs.get(frame.execId)?.({ kind: 'out', data: frame.data })
      case 'docker:exec:exit':
        return dockerExecSubs.get(frame.execId)?.({ kind: 'exit' })
    }
  },
  () => [...dockerStreamSubs.keys()].map((key) => {
    const [kind, id] = splitStreamKey(key)
    return { channel: `docker:${kind}:attach`, id }
  }),
)

// Test seam: these maps are module singletons, and core's _resetWsClient no longer knows about them.
export const _resetDockerWsChannel = (): void => {
  dockerChangedSubs.clear()
  dockerStreamSubs.clear()
  dockerExecSubs.clear()
}
