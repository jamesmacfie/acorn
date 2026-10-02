// Docker's half of the WebSocket. Core owns the envelope and routes on the `docker` prefix
// (@acorn/client-core/infra/node/wsChannels.ts). The maps, the payload narrowing, and the reattach set below
// belong to this plugin.
import { activeNodeId, registerWsChannel, wsConnect, wsSend, wsSendToNode } from '@acorn/plugin-api/client'
import { captureDockerScope, onDockerRetired, type DockerScopeOwner } from './dockerScope'
import type { DockerServerFrame, DockerStatsSample } from '../shared/wsFrames'

const dockerChangedSubs = new Set<(scopes: string[]) => void>()
// Log/stats stream subscribers, keyed `${kind}:${id}`: the first-attach / last-detach contract,
// and the set the reconnect reattach below is computed from.
export type DockerStreamEvent = { kind: 'log'; data: string } | { kind: 'stats'; sample: DockerStatsSample } | { kind: 'end' }
type Stream = { owner: DockerScopeOwner; kind: 'logs' | 'stats'; id: string; listeners: Set<(event: DockerStreamEvent) => void> }
const dockerStreamSubs = new Map<string, Stream>()
const streamKey = (kind: string, id: string): string => JSON.stringify([activeNodeId(), kind, id])
// Interactive docker-exec PTYs: one listener per execId, and no reconnect reattach. The PTY dies
// with the connection, the pane shows the exit, and the user reopens.
export type DockerExecEvent = { kind: 'out'; data: string } | { kind: 'exit' }
type Exec = { owner: DockerScopeOwner; callback: (event: DockerExecEvent) => void }
const dockerExecSubs = new Map<string, Exec>()
const execKey = (id: string): string => JSON.stringify([activeNodeId(), id])
const sendOwned = (owner: DockerScopeOwner, frame: Parameters<typeof wsSend>[0]) => {
  if (owner.nodeId) wsSendToNode(owner.nodeId, frame)
  else if (owner.current()) wsSend(frame)
}

// Docker cache-dirty pings (the docker plugin's event-driven refresh edge).
export function wsOnDockerChanged(cb: (scopes: string[]) => void): () => void {
  dockerChangedSubs.add(cb)
  wsConnect()
  return () => void dockerChangedSubs.delete(cb)
}

// Open an interactive docker-exec PTY; returns a dispose that kills it. Input/resize ride the
// same socket via the exported senders.
export function wsDockerExecOpen(execId: string, ref: string, cols: number, rows: number, cb: (event: DockerExecEvent) => void, owner = captureDockerScope()): () => void {
  const key = execKey(execId)
  if (!owner.current()) return () => {}
  const entry = { owner, callback: cb }
  dockerExecSubs.set(key, entry)
  wsConnect()
  sendOwned(entry.owner, { channel: 'docker:exec:open', execId, ref, cols, rows })
  return () => {
    if (dockerExecSubs.get(key) !== entry) return
    dockerExecSubs.delete(key)
    sendOwned(entry.owner, { channel: 'docker:exec:kill', execId })
  }
}

export function wsDockerExecInput(execId: string, data: string, owner = captureDockerScope()): void {
  const entry = dockerExecSubs.get(execKey(execId))
  if (owner.current() && entry?.owner.current()) sendOwned(entry.owner, { channel: 'docker:exec:in', execId, data })
}

export function wsDockerExecResize(execId: string, cols: number, rows: number, owner = captureDockerScope()): void {
  const entry = dockerExecSubs.get(execKey(execId))
  if (owner.current() && entry?.owner.current()) sendOwned(entry.owner, { channel: 'docker:exec:resize', execId, cols, rows })
}

// Subscribe to a docker log/stats stream; returns an unsubscribe. First local subscriber per
// (kind, container) attaches, the last detaches: the wsAttach contract.
export function wsDockerAttach(kind: 'logs' | 'stats', id: string, cb: (event: DockerStreamEvent) => void): () => void {
  const key = streamKey(kind, id)
  let entry = dockerStreamSubs.get(key)
  const first = !entry
  if (!entry) {
    entry = { owner: captureDockerScope(), kind, id, listeners: new Set() }
    dockerStreamSubs.set(key, entry)
  }
  const owned = entry
  owned.listeners.add(cb)
  wsConnect()
  if (first) sendOwned(owned.owner, { channel: `docker:${kind}:attach`, id })
  return () => {
    if (dockerStreamSubs.get(key) !== owned || !owned.listeners.delete(cb)) return
    if (owned.listeners.size) return
    dockerStreamSubs.delete(key)
    sendOwned(owned.owner, { channel: `docker:${kind}:detach`, id })
  }
}

onDockerRetired(() => {
  const streams = [...dockerStreamSubs.values()]
  const execs = [...dockerExecSubs.entries()]
  dockerStreamSubs.clear()
  dockerExecSubs.clear()
  for (const entry of streams) {
    sendOwned(entry.owner, { channel: `docker:${entry.kind}:detach`, id: entry.id })
    for (const cb of entry.listeners) cb({ kind: 'end' })
  }
  for (const [key, entry] of execs) {
    const [, execId] = JSON.parse(key) as [string | null, string]
    sendOwned(entry.owner, { channel: 'docker:exec:kill', execId })
    entry.callback({ kind: 'exit' })
  }
})

registerWsChannel(
  'docker',
  (rawFrame) => {
    // The one cast, at the front door, against this plugin's own union (../shared/wsFrames.ts).
    const frame = rawFrame as DockerServerFrame
    switch (frame.channel) {
      case 'docker:changed':
        return dockerChangedSubs.forEach((cb) => cb(frame.scopes))
      case 'docker:log':
        return void dockerStreamSubs.get(streamKey('logs', frame.id))?.listeners.forEach((cb) => cb({ kind: 'log', data: frame.data }))
      case 'docker:stats':
        return void dockerStreamSubs.get(streamKey('stats', frame.id))?.listeners.forEach((cb) => cb({ kind: 'stats', sample: frame.sample }))
      case 'docker:stream-end':
        return void dockerStreamSubs.get(streamKey(frame.kind, frame.id))?.listeners.forEach((cb) => cb({ kind: 'end' }))
      case 'docker:exec:out':
        return dockerExecSubs.get(execKey(frame.execId))?.callback({ kind: 'out', data: frame.data })
      case 'docker:exec:exit':
        return dockerExecSubs.get(execKey(frame.execId))?.callback({ kind: 'exit' })
    }
  },
  () => [...dockerStreamSubs.values()].filter(entry => entry.owner.current()).map(({ kind, id }) => ({ channel: `docker:${kind}:attach`, id })),
  (frame) => {
    if (typeof frame.id !== 'string') return
    if (frame.channel === 'docker:logs:attach' || frame.channel === 'docker:logs:detach') return { key: `docker:logs:${frame.id}`, state: frame.channel.endsWith(':attach') ? 'attached' : 'detached' }
    if (frame.channel === 'docker:stats:attach' || frame.channel === 'docker:stats:detach') return { key: `docker:stats:${frame.id}`, state: frame.channel.endsWith(':attach') ? 'attached' : 'detached' }
  },
)

// Test seam: these maps are module singletons, and core's _resetWsClient does not know about them.
export const _resetDockerWsChannel = (): void => {
  dockerChangedSubs.clear()
  dockerStreamSubs.clear()
  dockerExecSubs.clear()
}
