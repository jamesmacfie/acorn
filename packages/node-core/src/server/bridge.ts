import type { Context } from 'hono'
import type { AppEnv } from './middleware/auth'
import { respondError } from './respond'

// A domain bridge is the service-process backing for a /v2 route family whose work needs a runtime
// handle the server layer doesn't own — a PTY engine, git, ripgrep, a pg pool, the worktree resolver.
// The route holds a slot; the plugin that owns the engine fills it from its `init` (or, for an
// app-composition concern, apps/node/src/service/runtime.ts does). `dev:node` leaves engine-only
// bridges null, so those routes answer a clean 503 instead of crashing (docs/electron.md § capability
// map). This is the seam server/routes/harness.ts pioneered, generalized so every migrated IPC domain
// shares one shape.
//
// WHICH MECHANISM. There are two ways a plugin hands core an implementation, and the choice is not a
// matter of taste — it follows from who is asking:
//
//   - A CAPABILITY (server/plugin/capabilities.ts) when the consumer holds the CapabilityRegistry:
//     another plugin's init, or a composition root. This is the default, and it is typed, disposable
//     and duplicate-checked.
//   - A BRIDGE SLOT when the consumer is a ROUTE HANDLER. A handler holds only `c.env`, and the
//     capability registry is deliberately kept off Env and RuntimeBindings — putting it there would
//     let any request reach the whole plugin graph, which is the opposite of what per-runtime
//     registries bought. A module-scope slot is what is left.
//
// So a slot is not a lesser capability, it is the answer to a different question. What a slot must
// NEVER be is a stand-in for something core could just call: a bridge whose implementation is also
// core's is pure indirection, and `configTrustBridgeSlot` was exactly that until it was deleted — the
// route now calls main/repoConfigTrust.ts directly.
//
// A plugin that fills a slot MUST null it in its dispose. The slots are module singletons, so a second
// startServiceRuntime in one process would otherwise leave core reading through a closed handle.

export type BridgeSlot<B> = {
  set(impl: B | null): void
  get(): B | null
}

export function bridgeSlot<B>(): BridgeSlot<B> {
  let impl: B | null = null
  return { set: (b) => void (impl = b), get: () => impl }
}

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
export async function viaBridge<B>(c: Context<AppEnv>, slot: BridgeSlot<B>, fn: (b: B) => Promise<unknown>): Promise<Response> {
  const impl = slot.get()
  if (!impl) return respondError(c, 503, 'bridge-unavailable')
  try {
    return c.json(await fn(impl))
  } catch (e) {
    if (e instanceof BridgeError) return respondError(c, e.status, e.code, e.message ? [e.message] : undefined)
    throw e
  }
}
