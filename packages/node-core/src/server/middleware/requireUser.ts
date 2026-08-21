import type { Context } from 'hono'
import { createMiddleware } from 'hono/factory'
import { respondError } from '../respond'
import type { AppEnv, Principal } from './auth'

// The single authentication gate for /v2 routes (docs/security.md § Transport and auth). Mounted
// once in createApp() over `/v2/*` (after authMiddleware), it replaces the per-route inline guards
// and gates on the resolved principal: either credential kind passes, so internal-token callers work
// exactly as device callers do.
export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.get('principal')) return respondError(c, 401, 'unauthenticated')
  await next()
})

export const ownerId = (c: Context<AppEnv>): string => c.get('principal')!.userId

// Device-only gate, for surfaces an agent-spawned child must never reach (docs/security.md §
// Transport and auth: why requireUser cannot express this on its own, the pairing-escalation finding
// this closes, and why the response is 403 rather than 401).
export const requireDevice = createMiddleware<AppEnv>(async (c, next) => {
  const principal = c.get('principal')
  if (!principal) return respondError(c, 401, 'unauthenticated')
  if (principal.kind !== 'device') return respondError(c, 403, 'interactive_user_required')
  await next()
})

// The rule on its own, for the one caller that has a principal but no request: a scheduled plugin run
// has neither (server/plugin/scheduleRun.ts) and must answer this question the same way a route does.
export const principalMayUseProviderCredential = (principal: Principal | null | undefined): boolean =>
  !!principal && (principal.kind === 'device' || principal.scope === 'service')

export const canUseProviderCredential = (c: Context<AppEnv>): boolean =>
  principalMayUseProviderCredential(c.get('principal'))

// Is this principal entitled to act on `taskId`?
//
// A device may act on any task. An internal token may act only on the task it was minted for
// (docs/security.md § Credential handling). Before scoped tokens that comparison was impossible, so
// routes/agentTools.ts took the taskId from the URL and a credential handed to task A's agent could
// drive task B's tools. The 'service' scope is unbound because the node's own loopback calls are not
export const mayActOnTask = (c: Context<AppEnv>, taskId: string): boolean => {
  const principal = c.get('principal')
  if (!principal) return false
  if (principal.kind === 'device' || principal.scope === 'service') return true
  return !!principal.taskId && principal.taskId === taskId
}

// Is this principal confined to a single task? The companion to mayActOnTask, for the two things the
// per-task boolean cannot express on its own:
//
//   - Filtering a list. `GET /v2/p/terminal/sessions` returns every PTY on the node, so a confined
//     caller has to be handed a filtered roster rather than a yes/no about the whole call.
//   - Deciding whether to resolve at all. The opaque-id routes (a PTY session, an agent session, a
//     workflow run) must look the owning task up before they can check it, and an unconfined caller
//     should skip that lookup rather than pay for it.
//
// This is a boolean and not "the task this principal is bound to", because the id-returning form has
// to use `null` for "unconfined", which collides with a `task`-scoped principal that somehow carries
// no taskId. Those two must produce opposite answers (allow everything vs allow nothing). Today
// verifyInternalToken rejects that token outright (server/auth/internalTokens.ts), so the collision is
// unreachable, but a guard whose correctness rests on an invariant two files away is still the wrong
// shape. Pair this with mayActOnTask per item and the malformed case denies rather than admits.
//
// Both call sites were first written as `mayActOnTask(c, '')`, true for a device, false for a
// task-scoped token, correct by accident and unreadable. Say the thing instead.
export const isTaskConfined = (c: Context<AppEnv>): boolean => {
  const principal = c.get('principal')
  return !!principal && principal.kind !== 'device' && principal.scope !== 'service'
}

// Middleware form of mayActOnTask, for a whole router whose paths are all `/:id/...` task-scoped
// (docs/security.md § Transport and auth: the adversarial-review finding this closes). 404, not 403,
// matching the agent-tool surface: the denial reveals nothing about which tasks exist.
export const requireTaskScope = createMiddleware<AppEnv>(async (c, next) => {
  const taskId = c.req.param('id')
  if (taskId && !mayActOnTask(c, taskId)) return respondError(c, 404, 'not_found')
  await next()
})

// Gate for routes that administer or spend the owner's provider connections (docs/security.md §
// Credential handling). requireDevice would be too strict: the node's own loopback calls ('service'
// scope) legitimately reach provider-backed reads to warm a mirror.
export const requireProviderAccess = createMiddleware<AppEnv>(async (c, next) => {
  if (!canUseProviderCredential(c)) return respondError(c, 403, 'interactive_user_required')
  await next()
})
