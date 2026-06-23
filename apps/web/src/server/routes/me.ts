import { Hono } from 'hono'
import type { AppEnv } from '../middleware/auth'

export const me = new Hono<AppEnv>().get('/', (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: 'unauthenticated' }, 401)
  return c.json(user)
})
