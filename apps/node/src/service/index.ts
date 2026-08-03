import { z } from 'zod'
import { desktopCapabilitiesOverRpc } from '@acorn/protocol/desktopCapabilities.ts'
import {
  ServiceRpcError,
  ServiceRpcPeer,
  serviceStartConfigSchema,
  type ServiceMessage,
  type ServiceMessageTransport,
  type ServiceState,
} from '@acorn/protocol/serviceProtocol.ts'
import { startServiceRuntime, type ServiceRuntime } from './runtime'

// `process.parentPort` is an addition Electron makes to the Node globals for utilityProcess
// children, and this package compiles against plain Node types by design — it is the Electron-free
// service (docs/vNext/architecture.md). So describe the handshake structurally rather than pulling
// in electron's types, exactly as node-core reads `process.resourcesPath`. Phase 1 replaces this
// transport with child_process + a socket, at which point the shim disappears.
type ParentPort = {
  postMessage(message: ServiceMessage): void
  on(event: 'message', listener: (event: { data: unknown }) => void): void
  off(event: 'message', listener: (event: { data: unknown }) => void): void
}

const parentPort = (process as { parentPort?: ParentPort }).parentPort
if (!parentPort) throw new Error('The acorn service must run as an Electron utility process')

const transport: ServiceMessageTransport = {
  send: (message: ServiceMessage) => parentPort.postMessage(message),
  subscribe: (listener) => {
    const receive = (event: { data: unknown }) => listener(event.data)
    parentPort.on('message', receive)
    return () => parentPort.off('message', receive)
  },
}

const peer = new ServiceRpcPeer(transport)
let runtime: ServiceRuntime | null = null

function stateChanged(state: ServiceState, detail?: string): void {
  peer.emit('service.state', detail ? { state, detail } : { state })
}

peer.register('service.start', async (payload) => {
  if (runtime) throw new ServiceRpcError('already_started', 'Service is already running')
  const config = serviceStartConfigSchema.parse(payload)
  stateChanged('starting')
  runtime = await startServiceRuntime({
    config,
    desktop: desktopCapabilitiesOverRpc(peer),
    stateChanged,
  })
  // The endpoint, identity and bearer the parent needs. V1 returned only `{ state: 'listening' }`
  // and the parent computed the origin itself from a pinned port.
  return runtime.started
})

peer.register('service.preview-rules', async (payload) => {
  if (!runtime) throw new ServiceRpcError('not_ready', 'Service has not started')
  const { taskId } = z.strictObject({ taskId: z.string().min(1) }).parse(payload)
  return runtime.previewRules(taskId)
})

peer.register('service.stop', async () => {
  await runtime?.stop()
  runtime = null
  return { stopped: true }
})

const stopForSignal = (): void => {
  void (runtime?.stop() ?? Promise.resolve()).finally(() => process.exit(0))
}
process.once('SIGTERM', stopForSignal)
process.once('SIGINT', stopForSignal)
