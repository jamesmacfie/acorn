import { utilityProcess, type UtilityProcess } from 'electron'
import { z } from 'zod'
import { registerDesktopCapabilityHandlers } from './desktopCapabilities'
import {
  ServiceRpcPeer,
  previewBrowserRuleSchema,
  serviceStartConfigSchema,
  serviceStartResultSchema,
  serviceStateEventSchema,
  type PreviewBrowserRule,
  type ServiceMessage,
  type ServiceMessageTransport,
  type ServiceStartConfig,
  type ServiceStartResult,
  type ServiceState,
} from '@acorn/protocol/serviceProtocol.ts'

export type ServiceHostEvents = {
  stateChanged?(state: ServiceState, detail?: string): void
  unexpectedExit?(code: number): void
}

export class ServiceHost {
  private child: UtilityProcess | null = null
  private peer: ServiceRpcPeer | null = null
  private disposeDesktopHandlers: (() => void) | null = null
  private stopping = false

  constructor(
    private readonly entry: string,
    private readonly config: ServiceStartConfig,
    private readonly events: ServiceHostEvents = {},
  ) {
    serviceStartConfigSchema.parse(config)
  }

  // Resolves with where the service bound, who it is, and the bearer to reach it with — everything
  // the connection broker needs. The caller supplies the previously-remembered device token so the
  // service can reuse it instead of creating a new device row on every launch.
  async start(rememberedDeviceToken?: string): Promise<ServiceStartResult> {
    if (this.child) throw new Error('Service host is already started')
    this.stopping = false
    const child = utilityProcess.fork(this.entry, [], {
      env: { ...process.env },
      serviceName: 'acorn-node-service',
      stdio: 'inherit',
    })
    this.child = child

    const transport: ServiceMessageTransport = {
      send: (message: ServiceMessage) => child.postMessage(message),
      subscribe: (listener) => {
        const receive = (message: unknown) => listener(message)
        child.on('message', receive)
        return () => child.off('message', receive)
      },
    }
    const peer = new ServiceRpcPeer(transport)
    this.peer = peer
    this.disposeDesktopHandlers = registerDesktopCapabilityHandlers(peer)
    peer.onEvent('service.state', (payload) => {
      const parsed = serviceStateEventSchema.safeParse(payload)
      if (parsed.success) this.events.stateChanged?.(parsed.data.state, parsed.data.detail)
    })

    const spawned = new Promise<void>((resolve, reject) => {
      const onSpawn = (): void => {
        child.off('exit', onEarlyExit)
        resolve()
      }
      const onEarlyExit = (code: number): void => {
        child.off('spawn', onSpawn)
        reject(new Error(`Service exited before startup (code ${code})`))
      }
      child.once('spawn', onSpawn)
      child.once('exit', onEarlyExit)
    })
    child.on('exit', (code) => this.handleExit(child, code))
    await spawned
    const result = await peer.request('service.start', { ...this.config, deviceToken: rememberedDeviceToken }, 60_000)
    // Parsed, not cast: this is the one place a malformed handoff would otherwise surface much later
    // as an unreachable node with no explanation.
    return serviceStartResultSchema.parse(result)
  }

  async previewRules(taskId: string): Promise<PreviewBrowserRule[]> {
    const peer = this.peer
    if (!peer) return []
    const value = await peer.request('service.preview-rules', { taskId })
    return z.array(previewBrowserRuleSchema).parse(value)
  }

  async stop(): Promise<void> {
    const child = this.child
    if (!child) return
    this.stopping = true
    try {
      await this.peer?.request('service.stop', {}, 15_000)
    } catch (error) {
      console.warn('[service-host] graceful stop failed:', error)
    }
    this.disposeConnection('Service stopped')
    child.kill()
    this.child = null
  }

  private handleExit(child: UtilityProcess, code: number): void {
    if (this.child !== child) return
    const unexpected = !this.stopping
    this.child = null
    this.disposeConnection(`Service exited with code ${code}`)
    if (unexpected) this.events.unexpectedExit?.(code)
  }

  private disposeConnection(reason: string): void {
    this.disposeDesktopHandlers?.()
    this.disposeDesktopHandlers = null
    this.peer?.close(reason)
    this.peer = null
  }
}
