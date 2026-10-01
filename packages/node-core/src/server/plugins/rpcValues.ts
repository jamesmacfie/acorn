export type WireRequest = { __acornRpc: 'call'; callId: number; functionId: number; args: unknown[]; argumentScope?: number }
export type WireResponse = { __acornRpc: 'result'; callId: number; ok: boolean; value: unknown }
export type WireSyncRequest = { __acornRpc: 'sync-call'; functionId: number; args: unknown[]; reply: SharedArrayBuffer; argumentScope?: number }
export type WireError = { __acornRpc: 'error'; name: string; message: string; stack?: string; code?: unknown; status?: unknown; permission?: unknown; resource?: unknown }
export type WireRequestValue = { __acornRpc: 'request'; url: string; method: string; headers: [string, string][]; body: Uint8Array | null; signal: unknown }
export type WireResponseValue = { __acornRpc: 'response'; status: number; statusText: string; headers: [string, string][]; body: Uint8Array }
export type WireAbortSignal = { __acornRpc: 'abort-signal'; id?: number; aborted: boolean; reason?: unknown }
export type WireAbort = { __acornRpc: 'abort'; id: number; reason: unknown }

export const SYNC_REPLY_BYTES = 4 * 1024 * 1024
// A synchronous reference is a pure, read-shaped call, so an answer is either immediate or never
// coming. Without a ceiling, a worker that crashed or wedged freezes the thread that called it, and
// on the host that thread is the node's event loop: no route answers and the broker's heartbeat
// stops, so one bad plugin reads as the whole node being unreachable.
export const SYNC_REPLY_TIMEOUT_MS = 5_000
export const HEADER_BYTES = Int32Array.BYTES_PER_ELEMENT * 2
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null
// An object that already survives a structured clone with its own shape, so neither side walks it key
// by key. `Object.entries` on a Uint8Array yields `{ '0': 26, '1': 80, … }`, and the receiver gets an
// object that looks close enough to the real thing to pass every check and then has no `.slice`.
//
// That was a live failure. A plugin reading an image through a capability got its bytes back as a
// numbered object and the route threw, which the host answered as a bare 500.
export const carriesItsOwnShape = (value: unknown): boolean =>
  value instanceof Date || value instanceof RegExp || ArrayBuffer.isView(value) || value instanceof ArrayBuffer
export const bodyBuffer = (value: Uint8Array): ArrayBuffer => {
  const copy = new Uint8Array(value.byteLength)
  copy.set(value)
  return copy.buffer
}

export const errorToWire = (error: unknown): WireError => {
  const source = error instanceof Error ? error : new Error(String(error))
  return {
    __acornRpc: 'error',
    name: source.name,
    message: source.message,
    ...(source.stack ? { stack: source.stack } : {}),
    ...('code' in source ? { code: (source as Error & { code?: unknown }).code } : {}),
    // `status` travels with `code` because the pair is one answer, not two facts. A provider error
    // that arrived with its code and no status stopped looking like a provider error to the host
    // (integrations/types.ts § isProviderOperationError), so a rejected credential was reported as
    // the provider being unavailable.
    ...('status' in source ? { status: (source as Error & { status?: unknown }).status } : {}),
    ...('permission' in source ? { permission: (source as Error & { permission?: unknown }).permission } : {}),
    ...('resource' in source ? { resource: (source as Error & { resource?: unknown }).resource } : {}),
  }
}

export const errorFromWire = (wire: WireError): Error => {
  const error = new Error(wire.message)
  error.name = wire.name
  if (wire.stack) error.stack = wire.stack
  if (wire.code !== undefined) (error as Error & { code?: unknown }).code = wire.code
  if (wire.status !== undefined) (error as Error & { status?: unknown }).status = wire.status
  if (wire.permission !== undefined) (error as Error & { permission?: unknown }).permission = wire.permission
  if (wire.resource !== undefined) (error as Error & { resource?: unknown }).resource = wire.resource
  return error
}
