import { activeNodeId, clientEvents, createLogger } from '@acorn/plugin-api/client'

export type DockerScopeOwner = { nodeId: string | null; current(): boolean }
const log = createLogger('docker-scope')
let generation = 0
const retirements = new Set<() => void>()

export function captureDockerScope(nodeId = activeNodeId()): DockerScopeOwner {
  const captured = generation
  return { nodeId, current: () => captured === generation && nodeId === activeNodeId() }
}

export const dockerScopeKey = (...ids: (string | null | undefined)[]): string =>
  JSON.stringify([activeNodeId(), ...ids])

export function onDockerRetired(retire: () => void): () => void {
  retirements.add(retire)
  return () => { retirements.delete(retire) }
}

export function retireDockerClient(): void {
  generation++
  for (const retire of retirements) {
    try { retire() } catch (error) { log.error('Docker retirement failed', error) }
  }
}

// The host emits this inside the Node selection batch, before incoming regions construct.
clientEvents.on('runtime:node-switched', retireDockerClient)
