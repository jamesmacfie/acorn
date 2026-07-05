import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { getDb, schema } from '../db'
import { cascadeDeleteIntegration } from '../db/cascade'
import { type Viewer, VIEWER_QUERY, linearData, linearError, linearFetch } from '../linear'
import type { AppEnv } from '../middleware/auth'
import { projectPath, rollbarData, rollbarFetch, type RollbarProject } from '../rollbar'
import { encryptSecret } from '../session'
import type { ConnectIntegrationRequest, Integration, IntegrationsResponse } from '../../shared/api'

type IntegrationRow = typeof schema.integrations.$inferSelect

const metaWorkspace = (meta: string | null): string | undefined => (meta ? (JSON.parse(meta) as { workspace?: string }).workspace : undefined)
const rowToIntegration = (r: IntegrationRow): Integration => ({ id: r.id, provider: r.provider as Integration['provider'], label: r.label, connected: true, workspace: metaWorkspace(r.meta) })

// /api/integrations — list/connect/disconnect third-party providers. Multi-row per provider; GitHub
// is synthesized (identity root, token lives in the session cookie), not a stored row. Provider
// read surfaces live in their own routers: routes/linear.ts, routes/rollbar.ts.
export const integrations = new Hono<AppEnv>()
  .get('/', async (c) => {
    const user = c.get('user')
    if (!user) return c.json({ error: 'unauthenticated' }, 401)
    const rows = await getDb(c.env).select().from(schema.integrations).where(eq(schema.integrations.userId, user.login))
    const list: Integration[] = [
      { id: 'github', provider: 'github', label: user.login, connected: true },
      ...rows.map(rowToIntegration),
    ]
    return c.json({ integrations: list } satisfies IntegrationsResponse)
  })
  // Connect a provider by pasting a token (validated + encrypted). Returns the new row. Multiple
  // rows of the same provider are allowed — each is a distinct connection.
  .post('/', async (c) => {
    const user = c.get('user')
    if (!user) return c.json({ error: 'unauthenticated' }, 401)
    const { provider, token } = (await c.req.json().catch(() => ({}))) as Partial<ConnectIntegrationRequest>
    if (!token || typeof token !== 'string') return c.json({ error: 'bad_request' }, 400)
    if (provider !== 'linear' && provider !== 'rollbar') return c.json({ error: 'unsupported_provider' }, 400)

    // Rollbar (docs/next 10): a project-read token, validated with one cheap /project call.
    if (provider === 'rollbar') {
      let project: RollbarProject
      try {
        project = await rollbarData<RollbarProject>(await rollbarFetch(token.trim(), projectPath))
      } catch {
        return c.json({ error: 'invalid_key' }, 400)
      }
      const row = {
        id: randomUUID(),
        userId: user.login,
        provider: 'rollbar',
        label: `Rollbar · ${project.name}`,
        accessToken: await encryptSecret(token.trim(), c.env.SESSION_ENC_KEY),
        meta: JSON.stringify({ project: project.name, projectId: project.id }),
        createdAt: Date.now(),
      }
      await getDb(c.env).insert(schema.integrations).values(row)
      return c.json({ integration: rowToIntegration(row) })
    }

    // Validate the key by reading the viewer; reject anything that doesn't authenticate.
    const res = await linearFetch(token.trim(), VIEWER_QUERY, {})
    if (linearError(res)) return c.json({ error: 'invalid_key' }, 400)
    let workspace: string
    try {
      workspace = (await linearData<Viewer>(res)).viewer.organization.name
    } catch {
      return c.json({ error: 'invalid_key' }, 400)
    }

    const row = { id: randomUUID(), userId: user.login, provider: 'linear', label: `Linear · ${workspace}`, accessToken: await encryptSecret(token.trim(), c.env.SESSION_ENC_KEY), meta: JSON.stringify({ workspace }), createdAt: Date.now() }
    await getDb(c.env).insert(schema.integrations).values(row)
    return c.json({ integration: rowToIntegration(row) })
  })
  // Disconnect one connection by id; cascade its workspace links, cached issues, and task links
  // (application-level — no FKs in the schema; see db/cascade.ts).
  .delete('/:id', async (c) => {
    const user = c.get('user')
    if (!user) return c.json({ error: 'unauthenticated' }, 401)
    const id = c.req.param('id')
    if (id === 'github') return c.json({ error: 'cannot_disconnect_github' }, 400)
    await cascadeDeleteIntegration(getDb(c.env), user.login, id)
    return c.body(null, 204)
  })
