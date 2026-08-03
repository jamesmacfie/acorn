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

// The supervision channel is an ordinary Node IPC channel: the parent spawns this file with
// `stdio: [..., 'ipc']` (apps/desktop/src/app/main/serviceHost.ts), so `process.send` exists and needs
// no framing of its own.
//
// This replaces a structural shim over Electron's `process.parentPort`, which existed only because this
// package compiles against plain Node types by design — it is the Electron-free service
// (docs/vNext/architecture.md). With a plain child process there is nothing Electron-shaped left to
// describe, and the service can now be started by anything that can spawn a Node process.
const send = process.send?.bind(process)
if (!send) throw new Error('The acorn service must be spawned with an IPC channel (stdio: [..., "ipc"])')

const transport: ServiceMessageTransport = {
  send: (message: ServiceMessage) => send(message),
  subscribe: (listener) => {
    const receive = (message: unknown) => listener(message)
    process.on('message', receive)
    return () => process.off('message', receive)
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
