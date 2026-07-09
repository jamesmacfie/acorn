import { Hono } from 'hono'
import type { Me } from '../../shared/api'
import type { AppEnv } from '../middleware/auth'
import { getUser } from '../middleware/requireUser'

export const me = new Hono<AppEnv>().get('/', (c) => {
  const u = getUser(c)
  // Public fields only — the GitHub token never leaves the server.
  return c.json({ login: u.login, name: u.name, avatar: u.avatar, scopes: u.scopes } satisfies Me)
})
