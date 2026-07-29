import { z } from 'zod'
import { desktopCapabilitiesOverRpc } from '../../core/shared/desktopCapabilities'
import {
  ServiceRpcError,
  ServiceRpcPeer,
  serviceStartConfigSchema,
  type ServiceMessage,
  type ServiceMessageTransport,
  type ServiceState,
} from '../../core/shared/serviceProtocol'
import { startServiceRuntime, type ServiceRuntime } from './runtime'

const parentPort = process.parentPort
if (!parentPort) throw new Error('The acorn service must run as an Electron utility process')

const transport: ServiceMessageTransport = {
  send: (message: ServiceMessage) => parentPort.postMessage(message),
  subscribe: (listener) => {
    const receive = (event: Electron.MessageEvent) => listener(event.data)
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
  return { state: 'listening' }
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
