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
  // The endpoint, certificate identity, and device bearer the parent needs to adopt the local Node.
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
