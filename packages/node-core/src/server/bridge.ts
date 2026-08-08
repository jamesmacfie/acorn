import type { Context } from 'hono'
import type { AppEnv } from './middleware/auth'
import { respondError } from './respond'
import { capabilityId, type CapabilityId } from './plugin/capabilities'

// Route handlers resolve their provider from the per-runtime registry carried by c.env. Keeping this
// helper in the historical bridge module makes the migration mechanical for existing route families;
// the module contains no mutable slot, setter, or process-global implementation.
export const routeCapability = <T>(id: string): CapabilityId<T> => capabilityId<T>(id)

// Route tests historically installed fakes through module setters. Keep that test ergonomics without
// reintroducing a production bridge: the map is consulted only when a test omits RuntimeBindings, and
// every production request resolves from its per-runtime registry.
const routeTestOverrides = new Map<string, unknown>()
export const setRouteTestCapability = <T>(id: CapabilityId<T>, impl: T | null): void => {
  if (impl === null) routeTestOverrides.delete(id)
  else routeTestOverrides.set(id, impl)
}

export const routeCapabilityFor = <T>(c: Context<AppEnv>, id: CapabilityId<T>): T | undefined =>
  (c.env?.CAPABILITIES?.get(id) ?? routeTestOverrides.get(id)) as T | undefined

export const routeTestCapabilityFor = <T>(id: CapabilityId<T>): T | undefined => routeTestOverrides.get(id) as T | undefined

// Thrown by a bridge to classify a failure as something other than a 500. `code` is the stable
// machine code (docs/api-reference.md §error-codes); `detail` carries human prose. Anything else a
// bridge throws propagates to onServerError → 500 'internal'.
export class BridgeError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409 | 422,
    readonly code: string,
    message?: string,
  ) {
    super(message ?? code)
    this.name = 'BridgeError'
  }
}

// The one route body for a bridge-backed handler: resolve the slot, run the call, JSON the result.
// A missing bridge → 503; a BridgeError → its declared status; any other throw bubbles to the app
// backstop as 500 'internal'.
export async function viaBridge<B>(c: Context<AppEnv>, id: CapabilityId<B>, fn: (b: B) => Promise<unknown>): Promise<Response> {
  const impl = routeCapabilityFor(c, id)
  if (!impl) return respondError(c, 503, 'bridge-unavailable')
  try {
    return c.json(await fn(impl))
  } catch (e) {
    if (e instanceof BridgeError) return respondError(c, e.status, e.code, e.message ? [e.message] : undefined)
    throw e
  }
}
