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
