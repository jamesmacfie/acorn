import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { auditRequest } from '../auditRequest'
import { routeCapabilityFor, BridgeError, viaBridge } from '../bridge'
import type { AppEnv } from '../middleware/auth'
import { respondError } from '../respond'
import { PLUGIN_STATE, pluginState } from '../plugin/pluginState'

const body = z.strictObject({ disabled: z.array(z.string().min(1)).max(200) })

// One of the four source forms, matched in the order the phase doc prefers them. Strict objects so a
// body carrying two forms at once is a parse error rather than a coin toss.
const installSource = z.union([
  z.strictObject({ github: z.string().min(1).max(200), tag: z.string().min(1).max(120).optional() }),
  z.strictObject({ npm: z.string().min(1).max(200), version: z.string().min(1).max(64).optional() }),
  z.strictObject({ url: z.string().min(1).max(2048) }),
  z.strictObject({ path: z.string().min(1).max(1024) }),
])
const installBody = z.strictObject({ source: installSource, allowDowngrade: z.boolean().optional() })
const updateBody = z.strictObject({ allowDowngrade: z.boolean().optional() })
const uninstallBody = z.strictObject({ purgeData: z.boolean().optional() })

// Every mutation here changes which code a node runs, and a client that retries a timed-out install
// must not install twice. The global middleware (server/index.ts) replays a repeated key but does not
// demand one, so the requirement is stated per route.
const requireIdempotencyKey = (c: Context<AppEnv>): Response | null =>
  c.req.header('idempotency-key')
    ? null
    : respondError(c, 400, 'bad_request', ['This request must carry an Idempotency-Key header.'])

// The installer's refusals are all operator-fixable — a bad manifest, an unreachable release, a
// downgrade — so they surface as one 400 carrying the sentence rather than a 500. Same stance
// routes/backup.ts takes for tar failures.
const asBadRequest = async <T>(work: () => Promise<T> | T): Promise<T> => {
  try {
    return await work()
  } catch (error) {
    throw new BridgeError(400, 'bad_request', error instanceof Error ? error.message : String(error))
  }
}

export const plugins = new Hono<AppEnv>()
  .get('/', (c) => viaBridge(c, PLUGIN_STATE, async (bridge) => pluginState(bridge)))
  // The client bundle itself (docs/plugins.md). Not viaBridge: that
  // helper always JSONs, and this is the one response in the family that is bytes.
  //
  // Authentication is by MOUNT — server/index.ts puts requireDevice over `/v2/core/plugins/*` as
  // well as the bare path, precisely so a route added here later cannot arrive ungated. A
  // task-scoped internal token gets 403: which code a device runs is an owner decision.
  .get('/:id/client.js', async (c) => {
    const bridge = routeCapabilityFor(c, PLUGIN_STATE)
    if (!bridge) return respondError(c, 503, 'bridge-unavailable')
    const bundle = await bridge.clientBundle(c.req.param('id'))
    if (!bundle) return respondError(c, 404, 'not_found')
    const etag = `"${bundle.hash}"`
    // Cheap because the hash is content: a device that already holds these bytes re-validates in one
    // round trip instead of re-transferring a megabyte of JavaScript over the broker.
    if (c.req.header('if-none-match') === etag) return c.body(null, 304)
    return c.body(bundle.bytes, 200, {
      'content-type': 'text/javascript; charset=utf-8',
      etag,
      'x-content-type-options': 'nosniff',
      // The device's cache is content-addressed and does the real caching; an HTTP cache in front of
      // a device-authenticated response would only add a second place for these bytes to live.
      'cache-control': 'private, no-store',
    })
  })
  .put('/', async (c) => {
    const parsed = body.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, PLUGIN_STATE, async (bridge) => {
      // Roster UNION installed: a client-only package has no roster row, and a toggle it cannot
      // accept is a checkbox that silently does not stick.
      const known = new Map<string, { required: boolean }>([
        ...bridge.installed().map((entry) => [entry.id, { required: false }] as const),
        ...bridge.roster().map((entry) => [entry.name, entry] as const),
      ])
      // Both rejections are 400 rather than a silent filter. A typo'd name that vanished would leave the
      // owner looking at a checkbox that would not stick and no explanation; a `required` name silently
      // dropped would do the same, and the client already knows which rows are not togglable.
      for (const name of parsed.data.disabled) {
        const entry = known.get(name)
        if (!entry) throw new BridgeError(400, 'bad_request', `Unknown plugin: ${name}`)
        if (entry.required) throw new BridgeError(400, 'bad_request', `${name} is a required plugin and cannot be disabled.`)
      }
      const before = [...bridge.disabled()].sort()
      bridge.setDisabled(parsed.data.disabled)
      const after = [...parsed.data.disabled].sort()
      // Only on a real change. The client PUTs the whole list on every toggle, and a no-op PUT — a
      // re-render, a second client re-saving what it already read — is not a decision anyone made.
      if (before.join(' ') !== after.join(' ')) {
        auditRequest(c, {
          action: 'plugins.disabled.changed',
          // The list, not a diff: which plugins a node runs decides which routes exist and which
          // databases open, so the state that was chosen is what an owner needs to see.
          details: { disabled: after.join(', ') || '(none)' },
        })
      }
      return pluginState(bridge)
    })
  })
  // ── Install, update, uninstall (docs/plugins.md) ────────────────────────
  //
  // Owner surface, like the rest of this router: device-gated by mount, never reachable with a
  // task-scoped internal token. A prompt-injected agent must not be able to make a node fetch and run
  // arbitrary code (docs/security.md § Tokens, routes, and agents).
  //
  // Nothing here starts a plugin. Each answers "the disk now says this", and the roster above turns
  // that into the pending state and the restart banner.
  .post('/install', async (c) => {
    const missing = requireIdempotencyKey(c)
    if (missing) return missing
    const parsed = installBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, PLUGIN_STATE, async (bridge) => {
      const result = await asBadRequest(() => bridge.install(parsed.data.source, { allowDowngrade: parsed.data.allowDowngrade }))
      auditRequest(c, {
        action: 'plugins.installed',
        subject: result.id,
        // The source as the owner gave it, not as it resolved: "which URL did I paste" is the question
        // an audit row gets read to answer, and the resolved asset URL is in the node's lockfile.
        details: { version: result.version, source: JSON.stringify(parsed.data.source) },
      })
      return result
    })
  })
  .post('/:id/update', async (c) => {
    const missing = requireIdempotencyKey(c)
    if (missing) return missing
    const parsed = updateBody.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    const id = c.req.param('id')
    return viaBridge(c, PLUGIN_STATE, async (bridge) => {
      const result = await asBadRequest(() => bridge.update(id, { allowDowngrade: parsed.data.allowDowngrade }))
      auditRequest(c, {
        action: 'plugins.updated',
        subject: result.id,
        details: { fromVersion: result.fromVersion, toVersion: result.toVersion },
      })
      return result
    })
  })
  .delete('/:id', async (c) => {
    const missing = requireIdempotencyKey(c)
    if (missing) return missing
    const parsed = uninstallBody.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    const id = c.req.param('id')
    return viaBridge(c, PLUGIN_STATE, async (bridge) => {
      const result = await asBadRequest(() => bridge.uninstall(id, { purgeData: parsed.data.purgeData }))
      // Whether the data went with it is the part of this that cannot be undone, so it is the part the
      // record has to carry.
      auditRequest(c, { action: 'plugins.uninstalled', subject: id, details: { dataPurged: result.dataPurged } })
      return result
    })
  })
