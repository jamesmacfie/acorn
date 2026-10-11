import { activeNodeId, clientEvents, createLogger, latestSignal } from '@acorn/plugin-api/client'

export type DockerScopeOwner = { nodeId: string | null; current(): boolean }
const log = createLogger('docker-scope')
// The Docker client's lifetime on one Node. Retiring the client aborts it.
const clientLifetime = latestSignal()
const retirements = new Set<() => void>()

export function captureDockerScope(nodeId = activeNodeId()): DockerScopeOwner {
  const lifetime = clientLifetime.signal
  return { nodeId, current: () => !lifetime.aborted && nodeId === activeNodeId() }
}

export const dockerScopeKey = (...ids: (string | null | undefined)[]): string =>
  JSON.stringify([activeNodeId(), ...ids])

export function onDockerRetired(retire: () => void): () => void {
  retirements.add(retire)
  return () => {
    retirements.delete(retire)
  }
}

export function retireDockerClient(): void {
  clientLifetime.next()
  for (const retire of retirements) {
    try {
      retire()
    } catch (error) {
      log.error('Docker retirement failed', error)
    }
  }
}

// The host emits this inside the Node selection batch, before incoming regions construct.
clientEvents.on('runtime:node-switched', retireDockerClient)
