import { Hono } from 'hono'
import type { AppEnv } from '../middleware/auth'

export const me = new Hono<AppEnv>().get('/', (c) => {
  const u = c.get('user')
  if (!u) return c.json({ error: 'unauthenticated' }, 401)
  // Public fields only — the GitHub token never leaves the server.
  return c.json({ login: u.login, name: u.name, avatar: u.avatar, scopes: u.scopes })
})
