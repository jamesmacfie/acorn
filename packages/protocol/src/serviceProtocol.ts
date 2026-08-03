import { z } from 'zod'

// Bumped to 2 for vNext: the start config lost `origin` (the service now chooses and reports its
// own endpoint) and `service.start` resolves a real result instead of `{ state }`. A version bump is
// a hard break by design — parent and child ship in the same artifact, so there is nothing to
// negotiate.
export const SERVICE_PROTOCOL_VERSION = 2

export const serviceStateSchema = z.enum([
  'starting',
  'migrating',
  'listening',
  'reconciling',
  'ready',
  'draining',
  'stopped',
  'failed',
])
export type ServiceState = z.infer<typeof serviceStateSchema>
export const serviceStateEventSchema = z.strictObject({
  state: serviceStateSchema,
  detail: z.string().optional(),
})

export const serviceStartConfigSchema = z.strictObject({
  dataDir: z.string().min(1),
  // No clientDir: the node serves no web assets (docs/vNext/architecture.md). The renderer ships with
  // the desktop app and loads from app://acorn, so there is nothing about the renderer's layout the
  // service needs to be told.
  version: z.string().min(1),
  isPackaged: z.boolean(),
  electronPath: z.string().min(1),
  mcpEntry: z.string().min(1),
  // The device token this client remembered from a previous boot, if any. The service reuses it when
  // it still authenticates, so the local bundle keeps ONE device row instead of accruing one per
  // launch; anything else (first run, a reset data root, a revoked device) is replaced and the
  // effective token comes back in the start result. Custody stays with the client — the service
  // never persists it.
  deviceToken: z.string().min(1).optional(),
})
export type ServiceStartConfig = z.infer<typeof serviceStartConfigSchema>

// What `service.start` resolves with. V1 returned `{ state: 'listening' }` and the parent derived
// the origin itself from a pinned port; the service now owns its endpoint and identity and reports
// them, which is what lets two nodes coexist and what carries the TLS pin once there is one.
export const serviceEndpointSchema = z.strictObject({
  origin: z.string().url(),
  port: z.number().int().min(1).max(65535),
})
export type ServiceEndpoint = z.infer<typeof serviceEndpointSchema>

export const serviceStartResultSchema = z.strictObject({
  state: serviceStateSchema,
  nodeId: z.string().uuid(),
  endpoint: serviceEndpointSchema,
  // The bearer the client authenticates with. Never logged.
  deviceToken: z.string().min(1),
  // The node's transport identity: the self-signed certificate to pin and its sha256 fingerprint
  // (docs/vNext/protocol.md § Transport and identity). Required, not optional — the listener is TLS
  // unconditionally, and an optional pin is a pin that silently is not one.
  fingerprint: z.string().min(1),
  certPem: z.string().min(1),
})
export type ServiceStartResult = z.infer<typeof serviceStartResultSchema>

export const previewBrowserRuleSchema = z.strictObject({
  id: z.string(),
  enabled: z.boolean(),
  urlPattern: z.string(),
  trigger: z.literal('load'),
  action: z.strictObject({
    type: z.literal('fill'),
    selector: z.string(),
    value: z.string(),
  }),
})
export type PreviewBrowserRule = z.infer<typeof previewBrowserRuleSchema>

export const previewNavStateSchema = z.strictObject({
  url: z.string(),
  canGoBack: z.boolean(),
  canGoForward: z.boolean(),
  loading: z.boolean(),
})
export type PreviewNavState = z.infer<typeof previewNavStateSchema>

export const serviceRpcMethods = [
  'service.start',
  'service.stop',
  'service.preview-rules',
  'desktop.preview-current-url',
  'desktop.preview-load-url',
  'desktop.preview-nav-state',
  'desktop.preview-navigate',
  'desktop.preview-evict',
  'desktop.browser-navigate',
  'desktop.browser-snapshot',
  'desktop.browser-click',
  'desktop.browser-fill',
  'desktop.browser-screenshot',
  'desktop.browser-console',
] as const
export const serviceRpcMethodSchema = z.enum(serviceRpcMethods)
export type ServiceRpcMethod = z.infer<typeof serviceRpcMethodSchema>

const rpcRequestSchema = z.strictObject({
  protocol: z.literal(SERVICE_PROTOCOL_VERSION),
  kind: z.literal('request'),
  id: z.string().min(1),
  method: serviceRpcMethodSchema,
  payload: z.unknown(),
})

const rpcResponseSchema = z.strictObject({
  protocol: z.literal(SERVICE_PROTOCOL_VERSION),
  kind: z.literal('response'),
  id: z.string().min(1),
  ok: z.boolean(),
  result: z.unknown().optional(),
  error: z.strictObject({ code: z.string(), message: z.string() }).optional(),
})

const rpcEventSchema = z.strictObject({
  protocol: z.literal(SERVICE_PROTOCOL_VERSION),
  kind: z.literal('event'),
  event: z.string().min(1),
  payload: z.unknown(),
})

export const serviceMessageSchema = z.discriminatedUnion('kind', [
  rpcRequestSchema,
  rpcResponseSchema,
  rpcEventSchema,
])
export type ServiceMessage = z.infer<typeof serviceMessageSchema>

export type ServiceMessageTransport = {
  send(message: ServiceMessage): void
  subscribe(listener: (message: unknown) => void): () => void
}

export class ServiceRpcError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ServiceRpcError'
  }
}

type Pending = {
  resolve(value: unknown): void
  reject(error: Error): void
  timer: ReturnType<typeof setTimeout>
}
type Handler = (payload: unknown) => unknown | Promise<unknown>

// Small bidirectional RPC peer over Electron utility-process messages. Both sides can serve requests
// concurrently; no global queue is held while a handler awaits, so a preview navigation may trigger
// a service-side page-rule lookup without deadlocking the original request.
export class ServiceRpcPeer {
  private sequence = 0
  private readonly pending = new Map<string, Pending>()
  private readonly handlers = new Map<ServiceRpcMethod, Handler>()
  private readonly eventListeners = new Map<string, Set<(payload: unknown) => void>>()
  private readonly unsubscribe: () => void
  private closed = false

  constructor(private readonly transport: ServiceMessageTransport) {
    this.unsubscribe = transport.subscribe((raw) => this.receive(raw))
  }

  register(method: ServiceRpcMethod, handler: Handler): () => void {
    this.handlers.set(method, handler)
    return () => {
      if (this.handlers.get(method) === handler) this.handlers.delete(method)
    }
  }

  onEvent(event: string, listener: (payload: unknown) => void): () => void {
    const listeners = this.eventListeners.get(event) ?? new Set()
    listeners.add(listener)
    this.eventListeners.set(event, listeners)
    return () => {
      listeners.delete(listener)
      if (!listeners.size) this.eventListeners.delete(event)
    }
  }

  emit(event: string, payload: unknown): void {
    if (this.closed) return
    this.transport.send({ protocol: SERVICE_PROTOCOL_VERSION, kind: 'event', event, payload })
  }

  request<T>(method: ServiceRpcMethod, payload: unknown, timeoutMs = 15_000): Promise<T> {
    if (this.closed) return Promise.reject(new ServiceRpcError('service_closed', 'Service connection is closed'))
    const id = `${Date.now()}-${++this.sequence}`
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new ServiceRpcError('service_timeout', `${method} timed out`))
      }, timeoutMs)
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject, timer })
      this.transport.send({ protocol: SERVICE_PROTOCOL_VERSION, kind: 'request', id, method, payload })
    })
  }

  close(reason = 'Service connection closed'): void {
    if (this.closed) return
    this.closed = true
    this.unsubscribe()
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new ServiceRpcError('service_closed', reason))
    }
    this.pending.clear()
    this.handlers.clear()
    this.eventListeners.clear()
  }

  private receive(raw: unknown): void {
    if (this.closed) return
    const parsed = serviceMessageSchema.safeParse(raw)
    if (!parsed.success) return
    const message = parsed.data
    if (message.kind === 'response') {
      const pending = this.pending.get(message.id)
      if (!pending) return
      clearTimeout(pending.timer)
      this.pending.delete(message.id)
      if (message.ok) pending.resolve(message.result)
      else pending.reject(new ServiceRpcError(message.error?.code ?? 'service_failed', message.error?.message ?? 'Service request failed'))
      return
    }
    if (message.kind === 'event') {
      for (const listener of this.eventListeners.get(message.event) ?? []) listener(message.payload)
      return
    }
    const handler = this.handlers.get(message.method)
    if (!handler) {
      this.transport.send({
        protocol: SERVICE_PROTOCOL_VERSION,
        kind: 'response',
        id: message.id,
        ok: false,
        error: { code: 'method_unavailable', message: `${message.method} is unavailable` },
      })
      return
    }
    void Promise.resolve()
      .then(() => handler(message.payload))
      .then(
        (result) => this.transport.send({ protocol: SERVICE_PROTOCOL_VERSION, kind: 'response', id: message.id, ok: true, result }),
        (error: unknown) => this.transport.send({
          protocol: SERVICE_PROTOCOL_VERSION,
          kind: 'response',
          id: message.id,
          ok: false,
          error: {
            code: error instanceof ServiceRpcError ? error.code : 'service_failed',
            message: error instanceof Error ? error.message : 'Service request failed',
          },
        }),
      )
  }
}
