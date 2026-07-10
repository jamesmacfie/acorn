import type { Context } from 'hono'
import { createMiddleware } from 'hono/factory'
import { respondError } from '../respond'
import type { AppEnv, SessionUser } from './auth'

// The single authentication gate for /api routes. Mounted once in createApp() over `/api/*`
// (after csrf + authMiddleware), it replaces the per-route inline guards. It gates on the
// resolved principal — either credential kind passes — so internal-token callers (empty
// GitHub token) work exactly as cookie callers do. See docs/security.md §3, §9.1.
export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.get('principal')) return respondError(c, 401, 'unauthenticated')
  await next()
})

// Read the caller identity inside a handler. Safe only downstream of requireUser, which asserts
// this same variable is present — gate and read share the one slot, so they can't desync.
export const getUser = (c: Context<AppEnv>): SessionUser => c.get('principal')!.user
