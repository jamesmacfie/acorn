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

// May this principal use a stored provider credential (a GitHub token, a Linear key)?
//
// A device may: every paired device is the owner. The 'service' scope may: the node calls its own HTTP
// surface over loopback to reuse serve-then-revalidate — plugins/notes' seedTaskNotes does exactly this
// to warm a cold PR mirror. A 'task'-scoped token may NOT, and that is the posture change Phase 2 makes
// deliberately.
//
// V1 enforced this structurally: the internal principal carried `token: ''`, so an agent-spawned child
// could not call GitHub at all. Moving the credential into an `integrations` row keyed by owner dropped
// that property, because ownerId(c) is identical for a device and an internal principal
// (docs/vNext/phase1-notes.md § "Accepted divergence"). The Phase 1 note recorded two objections to
// gating it, and scoping answers both: it is no longer "one guard for two different callers" (the
// service keeps its reach, so seedTaskNotes still works), and while it is true that an agent has a shell
// with the owner's git credentials and can push anyway, "it could do it another way" is not a reason for
// the node to hand it a token it never needs.
export const canUseProviderCredential = (c: Context<AppEnv>): boolean => {
  const principal = c.get('principal')
  if (!principal) return false
  return principal.kind === 'device' || principal.scope === 'service'
}

// Is this principal entitled to act on `taskId`?
//
// A device may act on any task. An internal token may act only on the task it was minted for — and
// before scoped tokens that comparison was impossible, so routes/agentTools.ts took the taskId from the
// URL and a credential handed to task A's agent could drive task B's tools. The 'service' scope is
// unbound because the node's own loopback calls are not task-specific.
export const mayActOnTask = (c: Context<AppEnv>, taskId: string): boolean => {
  const principal = c.get('principal')
  if (!principal) return false
  if (principal.kind === 'device' || principal.scope === 'service') return true
  return !!principal.taskId && principal.taskId === taskId
}

// Is this principal confined to a single task? The companion to mayActOnTask, for the two things the
// per-task boolean cannot express on its own:
//
//   - FILTERING a list. `GET /v2/p/terminal/sessions` returns every PTY on the node, so a confined
//     caller has to be handed a filtered roster rather than a yes/no about the whole call.
//   - Deciding whether to RESOLVE at all. The opaque-id routes (a PTY session, an agent session, a
//     workflow run) must look the owning task up before they can check it, and an unconfined caller
//     should skip that lookup rather than pay for it.
//
// Deliberately a boolean and not "the task this principal is bound to". The id-returning form has to
// use `null` for "unconfined", which collides with a `task`-scoped principal that somehow carries no
// taskId — and those two must produce OPPOSITE answers (allow everything vs allow nothing). Today
// verifyInternalToken rejects that token outright (server/auth/internalTokens.ts), so the collision is
// unreachable; a guard whose correctness rests on an invariant two files away is still the wrong shape.
// Pair this with mayActOnTask per item and the malformed case denies rather than admits.
//
// Both call sites were first written as `mayActOnTask(c, '')` — true for a device, false for a
// task-scoped token, correct by accident and unreadable. Say the thing instead.
export const isTaskConfined = (c: Context<AppEnv>): boolean => {
  const principal = c.get('principal')
  return !!principal && principal.kind !== 'device' && principal.scope !== 'service'
}

// Middleware form of mayActOnTask, for a whole router whose paths are all `/:id/...` task-scoped.
//
// An adversarial review found that mayActOnTask was applied at exactly ONE site (agentTools), so a
// task-scoped credential could still POST /v2/core/tasks/<other>/preview-url and get arbitrary shell
// execution in another task's worktree — confirmed by probe. A per-route guard was clearly not going to
// stay applied; a mounted gate is.
//
// 404, not 403, matching the agent-tool surface: the denial reveals nothing about which tasks exist.
export const requireTaskScope = createMiddleware<AppEnv>(async (c, next) => {
  const taskId = c.req.param('id')
  if (taskId && !mayActOnTask(c, taskId)) return respondError(c, 404, 'not_found')
  await next()
})

// Gate for routes that administer or spend the owner's provider connections.
//
// requireDevice would be too strict — the node's own loopback calls ('service' scope) legitimately reach
// provider-backed reads to warm a mirror. This is requireDevice ∪ service, i.e. the middleware form of
// canUseProviderCredential.
export const requireProviderAccess = createMiddleware<AppEnv>(async (c, next) => {
  if (!canUseProviderCredential(c)) return respondError(c, 403, 'interactive_user_required')
  await next()
})
