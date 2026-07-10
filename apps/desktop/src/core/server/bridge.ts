import type { Context } from 'hono'
import type { AppEnv } from './middleware/auth'
import { respondError } from './respond'

// A domain bridge is the main-process backing for an /api route family whose work needs a runtime
// handle the server layer doesn't own — a PTY engine, git, ripgrep, a pg pool, the worktree
// resolver. The route holds a slot; the composition root (main/bootstrap.ts) or the server bridge
// wiring (main/serverBridges.ts) fills it at boot. dev:node leaves the Electron-only bridges null,
// so those routes answer a clean 503 instead of crashing (docs/next Phase 3 §6 capability map).
// This is the same seam server/routes/harness.ts pioneered, generalized so every migrated IPC
// domain shares one shape.

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
