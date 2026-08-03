import type { Context } from 'hono'
import { createMiddleware } from 'hono/factory'
import { respondError } from '../respond'
import type { AppEnv } from './auth'

// The single authentication gate for /v2 routes. Mounted once in createApp() over `/v2/*`
// (after authMiddleware), it replaces the per-route inline guards. It gates on the resolved
// principal — either credential kind passes — so internal-token callers work exactly as device
// callers do. See docs/security.md §3, §9.1.
export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.get('principal')) return respondError(c, 401, 'unauthenticated')
  await next()
})

// The owner id to scope this request's data by. Safe only downstream of requireUser, which asserts the
// same variable is present — gate and read share the one slot, so they cannot desync.
//
// This used to be `getUser(c)`, returning the whole decrypted session — login, display name, avatar,
// scopes, and the GitHub token. Every one of the ~60 call sites read `.login` and nothing else, which is
// why the narrowing is a rename rather than a refactor. Named `ownerId` rather than `userId` because
// `userId` is the name of a column on a dozen tables and half these call sites already have a local by
// that name; shadowing the accessor with the value it produced would be a TDZ error waiting to happen.
export const ownerId = (c: Context<AppEnv>): string => c.get('principal')!.userId

// Device-only gate, for surfaces an agent-spawned child must never reach.
//
// requireUser deliberately accepts either credential kind, which is right for product routes: the MCP
// server and agent sessions read and write task data as the owner. But docs/vNext/security.md is
// explicit that an internal token "can never read secrets back, mint tokens, pair, or touch device
// management" — and requireUser cannot express that, because it only asserts that SOME principal
// resolved.
//
// Without this, the internal token injected into every PTY/agent session env (ACORN_API_TOKEN) was a
// complete privilege escalation: POST /v2/core/pair/start returns the pairing code in its response
// body, so an agent could open a window, read the code, POST /v2/pair, and walk away with a permanent
// owner-authority device token — then revoke the owner's own devices. Verified end to end before this
// gate existed.
//
// 403 rather than 401: the caller authenticated fine, it just is not the owner at a keyboard. A 401
// would invite the MCP client to retry with the same credential forever.
export const requireDevice = createMiddleware<AppEnv>(async (c, next) => {
  const principal = c.get('principal')
  if (!principal) return respondError(c, 401, 'unauthenticated')
  if (principal.kind !== 'device') return respondError(c, 403, 'interactive_user_required')
  await next()
})
