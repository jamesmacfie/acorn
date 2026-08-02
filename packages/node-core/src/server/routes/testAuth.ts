import type { Context, Next } from 'hono'
import type { AppEnv, Principal } from '../middleware/auth'
import { requireUser } from '../middleware/requireUser'

// The auth slice of the mount contract for route tests: seed the principal exactly as
// authMiddleware would, then run the real requireUser gate. Spread into
// `.use('/api/*', ...testGate(principal))` so tests can't drift from the seed → gate
// order createApp() enforces. Pass `null` for a logged-out request.
export const testGate = (principal: Principal | null) =>
  [
    async (c: Context<AppEnv>, next: Next) => {
      c.set('principal', principal)
      await next()
    },
    requireUser,
  ] as const
