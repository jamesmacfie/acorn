import { createMiddleware } from 'hono/factory'

export type SessionUser = {
  login: string
  name: string
  avatar: string
  scopes: string[]
}

export type AppEnv = { Bindings: Env; Variables: { user: SessionUser | null } }

// ponytail: stub. Real impl reads the __Host-session cookie and decrypts it in-CPU
// (AES-GCM/JWE, key = SESSION_ENC_KEY) per docs/api-structure.md#auth-middleware.
// No session exists yet, so every request is unauthenticated. Add sealing when auth lands.
export const authMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  c.set('user', null)
  await next()
})
