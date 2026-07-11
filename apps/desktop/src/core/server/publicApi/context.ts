import type { ApiTokenPrincipal } from './tokenService'

// Hono env for the public /api/v1 app. Bindings are the same runtime object the internal app sees
// (env.d.ts global Env); Variables carry per-request public state resolved by middleware.
export type PublicAppEnv = {
  Bindings: Env
  Variables: {
    requestId: string
    principal: ApiTokenPrincipal
  }
}
