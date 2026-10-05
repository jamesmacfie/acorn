import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { decidePluginRequest, pendingPluginRequest } from '../../agentTools/pluginRequests'
import { auditRequest } from '../../auditRequest'
import { broadcastPluginsChanged } from '../../notify'
import { routeCapabilityFor, BridgeError, viaBridge } from '../../bridge'
import type { AppEnv } from '../../middleware/auth'
import { respondError } from '../../respond'
import { PLUGIN_STATE, pluginState } from '../../pluginHost/state'
import { dispatchPluginRoute } from '../../pluginHost/dispatch'
import { validatePluginCliValue, PLUGIN_CLI_INPUT_MAX_BYTES, PLUGIN_CLI_OUTPUT_MAX_BYTES } from '@acorn/protocol/plugin/cliCommands.ts'
import { getDb } from '../../db'
import { projects, tasks, workspaces } from '../../db/schema'
import { eq } from 'drizzle-orm'
import type { PluginInputGrant, PluginInputGrantState } from '@acorn/protocol/api.ts'
import { declaredInputs, sameInputs } from '../../plugins/inputGrants'
import { pluginInputUsage } from '../../dashboards/inputUsage'

const body = z.strictObject({ disabled: z.array(z.string().min(1)).max(200) })

// One of the four source forms, matched in the order the phase doc prefers them. Strict objects so a
// body carrying two forms at once is a parse error rather than a coin toss.
const installSource = z.union([
  z.strictObject({ github: z.string().min(1).max(200), tag: z.string().min(1).max(120).optional() }),
  z.strictObject({ npm: z.string().min(1).max(200), version: z.string().min(1).max(64).optional() }),
  z.strictObject({ url: z.string().min(1).max(2048) }),
  z.strictObject({ path: z.string().min(1).max(1024) }),
])
const installBody = z.strictObject({ source: installSource, allowDowngrade: z.boolean().optional(), reviewRequestId: z.uuid().optional() })
const updateBody = z.strictObject({ allowDowngrade: z.boolean().optional(), reviewRequestId: z.uuid().optional() })
const uninstallBody = z.strictObject({ purgeData: z.boolean().optional() })
const reviewBody = z.strictObject({ reviewId: z.uuid(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/), decision: z.enum(['approved', 'denied']) })
const sameSource = (left: unknown, right: unknown): boolean =>
  !!left && !!right && JSON.stringify(Object.entries(left as Record<string, unknown>).sort()) === JSON.stringify(Object.entries(right as Record<string, unknown>).sort())
// The owner's answer to one agent-raised request. The device writes `message`, never the agent: the
// sentence the agent is told is the one piece of this exchange the human's side owns.
const requestDecisionBody = z.strictObject({
  decision: z.enum(['approved', 'denied']),
  message: z.string().min(1).max(400).optional(),
})
const bundleHash = /^[0-9a-f]{64}$/
// The exact input list the person saw, keyed as a grant keys it (server/plugins/inputGrants.ts).
const inputGrantBody = z.strictObject({
  sources: z.record(z.string().min(1).max(200), z.record(z.string().min(1).max(32),
    z.strictObject({ source: z.string().min(1).max(401), optional: z.boolean() }))),
})

// Every mutation here changes which code a node runs, and a client that retries a timed-out install
// must not install twice. The global middleware (server/index.ts) replays a repeated key but does not
// demand one, so the requirement is stated per route.
const requireIdempotencyKey = (c: Context<AppEnv>): Response | null =>
  c.req.header('idempotency-key')
    ? null
    : respondError(c, 400, 'bad_request', ['This request must carry an Idempotency-Key header.'])

const boundedCommandOutput = async (response: Response): Promise<string | null> => {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let bytes = 0
  let text = ''
  for (;;) {
    const part = await reader.read()
    if (part.done) break
    bytes += part.value.byteLength
    if (bytes > PLUGIN_CLI_OUTPUT_MAX_BYTES) { await reader.cancel().catch(() => {}); return null }
    text += decoder.decode(part.value, { stream: true })
  }
  return text + decoder.decode()
}

// The installer's refusals are all operator-fixable: a bad manifest, an unreachable release, a
// downgrade. They surface as one 400 carrying the sentence rather than a 500, the stance
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
  // Resolve against the running declaration on every call. A pending install, disable, or
  // failed reload cannot leave a stale executable command behind in a long-lived CLI.
  .post('/:id/cli/:name', async (c) => {
    const bridge = routeCapabilityFor(c, PLUGIN_STATE)
    if (!bridge) return respondError(c, 503, 'bridge-unavailable')
    const id = c.req.param('id')
    const row = pluginState(bridge).plugins.find((entry) => entry.name === id)
    const descriptor = row?.running && !row.disabled && row.active?.activation === 'node'
      ? row.active.contributions.cliCommands?.find((command) => command.name === c.req.param('name')) : undefined
    if (!descriptor) return respondError(c, 404, 'not_found')
    if (!row?.active?.permissions.node.core.includes(descriptor.capability)) return respondError(c, 403, 'forbidden')
    if (descriptor.risk === 'write' && !c.req.header('idempotency-key')) {
      return respondError(c, 400, 'bad_request', ['Write commands require an Idempotency-Key.'])
    }
    const raw = await c.req.text()
    if (Buffer.byteLength(raw, 'utf8') > PLUGIN_CLI_INPUT_MAX_BYTES + 32) return respondError(c, 413, 'bad_request', ['Command input is too large.'])
    let parsed: unknown
    try { parsed = JSON.parse(raw) } catch { return respondError(c, 400, 'bad_request', ['Command body must be JSON.']) }
    const body = parsed as { input?: unknown } | null
    if (!body || typeof body !== 'object' || Array.isArray(body) || !('input' in body) || Object.keys(body).some((key) => key !== 'input')) {
      return respondError(c, 400, 'bad_request', ['Command body must contain only input.'])
    }
    if (Buffer.byteLength(JSON.stringify(body.input), 'utf8') > PLUGIN_CLI_INPUT_MAX_BYTES) return respondError(c, 413, 'bad_request', ['Command input is too large.'])
    const errors = validatePluginCliValue(descriptor.inputSchema, body.input)
    if (errors.length) return respondError(c, 400, 'bad_request', errors.map((issue) => `${issue.path}: ${issue.message}`))
    const input = body.input as Record<string, unknown>
    if (input.nodeId !== c.env.NODE_ID) return respondError(c, 400, 'bad_request', ['$.nodeId: selected Node does not match.'])
    const db = getDb(c.env)
    const workspaceId = input.workspaceId
    const projectId = input.projectId
    const taskId = input.taskId
    if (descriptor.scope !== 'node') {
      if (descriptor.scope === 'workspace') {
        if (typeof workspaceId !== 'string' || !(await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.id, workspaceId)).get())) return respondError(c, 404, 'not_found')
      } else if (descriptor.scope === 'project') {
        const project = typeof projectId === 'string' ? await db.select({ workspaceId: projects.workspaceId }).from(projects).where(eq(projects.id, projectId)).get() : null
        if (!project || (workspaceId !== undefined && workspaceId !== project.workspaceId)) return respondError(c, 404, 'not_found')
      } else {
        const task = typeof taskId === 'string' ? await db.select({ projectId: tasks.projectId }).from(tasks).where(eq(tasks.id, taskId)).get() : null
        if (!task) return respondError(c, 404, 'not_found')
        const project = await db.select({ workspaceId: projects.workspaceId }).from(projects).where(eq(projects.id, task.projectId)).get()
        if (!project || (projectId !== undefined && projectId !== task.projectId) || (workspaceId !== undefined && workspaceId !== project.workspaceId)) return respondError(c, 404, 'not_found')
      }
    }
    let response: Response
    try {
      response = await dispatchPluginRoute(c.env, id, `/v1/p/${id}${descriptor.route.path}`, {
        method: descriptor.route.method, body: JSON.stringify(input),
      }, AbortSignal.timeout(30_000), c.get('principal')!)
    } catch { return respondError(c, 502, 'plugin_command_failed') }
    if (!response.ok) return respondError(c, 502, 'plugin_command_failed', [`Plugin handler returned HTTP ${response.status}.`])
    const output = await boundedCommandOutput(response)
    if (output === null) return respondError(c, 502, 'invalid_response', ['Plugin command output is too large.'])
    let result: unknown
    try { result = JSON.parse(output) } catch { return respondError(c, 502, 'invalid_response', ['Plugin command output is not JSON.']) }
    const outputErrors = validatePluginCliValue(descriptor.outputSchema, result)
    if (outputErrors.length) return respondError(c, 502, 'invalid_response', outputErrors.map((issue) => `${issue.path}: ${issue.message}`))
    return c.json({ result })
  })
  // The client bundle itself (docs/plugins.md). Not viaBridge, because that helper always JSONs and
  // this is the one response in the family that is bytes.
  //
  // Gated by mount, not by handler (docs/security/transport-and-auth.md § Transport and auth). A task-scoped internal
  // token gets 403, because which code a device runs is an owner decision.
  .get('/:id/bundles/:hash', async (c) => {
    const bridge = routeCapabilityFor(c, PLUGIN_STATE)
    if (!bridge) return respondError(c, 503, 'bridge-unavailable')
    const id = c.req.param('id')
    const hash = c.req.param('hash')
    if (!bundleHash.test(hash)) return respondError(c, 404, 'not_found')
    const advertised = pluginState(bridge).plugins.find((row) => row.name === id)
    if (advertised?.active?.client?.hash !== hash && advertised?.installed?.client?.hash !== hash) {
      return respondError(c, 404, 'not_found')
    }
    const bundle = await bridge.clientBundle(id, hash)
    if (!bundle || bundle.hash !== hash) return respondError(c, 404, 'not_found')
    const etag = `"${bundle.hash}"`
    // Cheap because the hash is content: a device that already holds these bytes re-validates in one
    // round trip instead of re-transferring a megabyte of JavaScript over the broker.
    if (c.req.header('if-none-match') === etag) return c.body(null, 304)
    return c.body(bundle.bytes, 200, {
      'content-type': 'text/javascript; charset=utf-8',
      etag,
      'x-content-type-options': 'nosniff',
      // The device's cache is content-addressed and does the real caching. An HTTP cache in front of
      // a device-authenticated response only adds a second place for these bytes to live.
      'cache-control': 'private, no-store',
    })
  })
  // Compatibility for clients that predate the advertised-hash route. Their roster names the current
  // installed candidate, so this endpoint continues to serve that candidate while they roll forward.
  .get('/:id/client.js', async (c) => {
    const bridge = routeCapabilityFor(c, PLUGIN_STATE)
    if (!bridge) return respondError(c, 503, 'bridge-unavailable')
    const id = c.req.param('id')
    const hash = bridge.installed().find((entry) => entry.id === id)?.client?.hash
    if (!hash) return respondError(c, 404, 'not_found')
    const bundle = await bridge.clientBundle(id, hash)
    if (!bundle) return respondError(c, 404, 'not_found')
    const etag = `"${bundle.hash}"`
    if (c.req.header('if-none-match') === etag) return c.body(null, 304)
    return c.body(bundle.bytes, 200, {
      'content-type': 'text/javascript; charset=utf-8', etag,
      'x-content-type-options': 'nosniff', 'cache-control': 'private, no-store',
    })
  })
  .put('/', async (c) => {
    const parsed = body.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, PLUGIN_STATE, async (bridge) => {
      // Roster union installed union what the loader refused. A client-only package has no roster row
      // and a package whose manifest never parsed is in neither. Turning a broken package off is the
      // owner's one way to stop it reporting, so this route has to recognise its name.
      const known = new Map<string, { required: boolean }>([
        ...bridge.loadFailures().map((entry) => [entry.id, { required: false }] as const),
        ...bridge.installed().map((entry) => [entry.id, { required: false }] as const),
        ...bridge.roster().map((entry) => [entry.name, entry] as const),
      ])
      // Both rejections are 400 rather than a silent filter. A dropped name leaves the owner looking at
      // a checkbox that will not stick, with no explanation.
      for (const name of parsed.data.disabled) {
        const entry = known.get(name)
        if (!entry) throw new BridgeError(400, 'bad_request', `Unknown plugin: ${name}`)
        if (entry.required) throw new BridgeError(400, 'bad_request', `${name} is a required plugin and cannot be disabled.`)
      }
      const before = [...bridge.disabled()].sort()
      bridge.setDisabled(parsed.data.disabled)
      const after = [...parsed.data.disabled].sort()
      // Only on a real change. The client PUTs the whole list on every toggle, and a no-op PUT is not a
      // decision anyone made.
      if (before.join(' ') !== after.join(' ')) {
        auditRequest(c, {
          action: 'plugins.disabled.changed',
          // The list, not a diff: which plugins a node runs decides which routes exist and which
          // databases open, so the owner needs to see the state that was chosen.
          details: { disabled: after.join(', ') || '(none)' },
        })
        broadcastPluginsChanged()
      }
      return pluginState(bridge)
    })
  })
  // Install, update, uninstall (docs/plugins/loaded-plugins.md § Loaded plugins). Owner surface, device-gated by
  // mount, never reachable with a task-scoped internal token (docs/security/credentials.md § Credential handling).
  //
  // Nothing here starts a plugin. Each answers "the disk says this", and the roster above turns that
  // into the pending state and the restart banner.
  //
  // Every one of them broadcasts `plugins:changed`. Until 2026-08-28 only `/:id/reload` did
  // (server/plugins/reload.ts), so a second window kept a stale roster and a stale restart banner until
  // someone refetched by hand — one desktop and one node makes that an edge case, and a fleet makes it
  // the normal one (docs/plugins/events.md § Hearing a core event). The frame is content-free: the client
  // re-reads the roster it can already fetch.
  .post('/install', async (c) => {
    const missing = requireIdempotencyKey(c)
    if (missing) return missing
    const parsed = installBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    if (parsed.data.reviewRequestId) {
      const request = pendingPluginRequest(parsed.data.reviewRequestId)
      if (!request || request.action !== 'install' || !sameSource(request.source, parsed.data.source)) return respondError(c, 400, 'bad_request', ['The staged install does not match a pending agent request.'])
    }
    return viaBridge(c, PLUGIN_STATE, async (bridge) => {
      const result = await asBadRequest(() => bridge.install(parsed.data.source, { allowDowngrade: parsed.data.allowDowngrade, reviewRequestId: parsed.data.reviewRequestId }))
      auditRequest(c, {
        action: 'plugins.installed',
        subject: result.id,
        // The source as the owner gave it, not as it resolved. "Which URL did I paste" is the question
        // an audit row gets read to answer, and the resolved asset URL is in the node's lockfile.
        details: { version: result.version, source: JSON.stringify(parsed.data.source) },
      })
      broadcastPluginsChanged()
      return result
    })
  })
  .post('/:id/update', async (c) => {
    const missing = requireIdempotencyKey(c)
    if (missing) return missing
    const parsed = updateBody.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    const id = c.req.param('id')
    if (parsed.data.reviewRequestId) {
      const request = pendingPluginRequest(parsed.data.reviewRequestId)
      if (!request || request.action !== 'update' || request.pluginId !== id) return respondError(c, 400, 'bad_request', ['The staged update does not match a pending agent request.'])
    }
    return viaBridge(c, PLUGIN_STATE, async (bridge) => {
      const result = await asBadRequest(() => bridge.update(id, { allowDowngrade: parsed.data.allowDowngrade, reviewRequestId: parsed.data.reviewRequestId }))
      auditRequest(c, {
        action: 'plugins.updated',
        subject: result.id,
        details: { fromVersion: result.fromVersion, toVersion: result.toVersion },
      })
      broadcastPluginsChanged()
      return result
    })
  })
  .post('/:id/review', async (c) => {
    const missing = requireIdempotencyKey(c)
    if (missing) return missing
    const parsed = reviewBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    const id = c.req.param('id')
    if (!/^[a-z][a-z0-9-]{1,31}$/.test(id)) return respondError(c, 400, 'bad_request')
    return viaBridge(c, PLUGIN_STATE, async (bridge) => {
      const pending = bridge.pendingReview(id)
      if (!pending || !('reviewId' in pending) || pending.reviewId !== parsed.data.reviewId || pending.fingerprint !== parsed.data.fingerprint) {
        throw new BridgeError(409, 'bad_request', 'This package review changed. Refresh the plugin list.')
      }
      if (parsed.data.decision === 'approved') {
        await asBadRequest(() => bridge.approveReview(id, pending.reviewId, pending.fingerprint))
      } else {
        await asBadRequest(() => bridge.uninstall(id, {}))
      }
      decidePluginRequest(pending.requestId, {
        decision: parsed.data.decision,
        message: parsed.data.decision === 'approved' ? `The owner reviewed and approved ${id}.` : `The owner reviewed and removed ${id}.`,
      })
      auditRequest(c, { action: 'plugins.review.decided', subject: id, details: { decision: parsed.data.decision } })
      broadcastPluginsChanged()
      return { ok: true }
    })
  })
  // The person's approval of what a loaded plugin's derived sources read
  // (docs/data-sources/derived-sources.md § Approve inputs for loaded plugins). The grant is checked at
  // each input read, so writing or removing it takes effect on the next request without a restart.
  .get('/:id/input-grant', (c) => viaBridge(c, PLUGIN_STATE, async (bridge) => {
    const id = c.req.param('id')
    const inputs = pluginState(bridge).plugins.find((row) => row.name === id)?.inputs
    if (!inputs) throw new BridgeError(404, 'not_found', `${id} reads no other sources.`)
    const stored = bridge.inputGrants().get(id)
    const grant: PluginInputGrant | null = stored ? { sources: stored.sources, grantedAt: stored.grantedAt, grantedBy: stored.grantedBy } : null
    return { inputs: inputs.inputs, grant, usage: pluginInputUsage(getDb(c.env), id) } satisfies PluginInputGrantState
  }))
  // The body is the list the dialog showed. A list that no longer matches the installed version is
  // refused, so a dialog left open across an update can't approve something it never showed.
  .post('/:id/input-grant', async (c) => {
    const parsed = inputGrantBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    const id = c.req.param('id')
    return viaBridge(c, PLUGIN_STATE, async (bridge) => {
      const declared = declaredInputs(bridge.installed().find((entry) => entry.id === id)?.contributions.dataSources)
      if (!Object.keys(declared).length) throw new BridgeError(404, 'not_found', `${id} reads no other sources.`)
      if (!sameInputs(declared, parsed.data.sources)) {
        throw new BridgeError(409, 'bad_request', 'What this plugin reads changed. Refresh the plugin list.')
      }
      const principal = c.get('principal')
      bridge.inputGrants().set({
        pluginId: id, sources: declared, grantedAt: Date.now(),
        grantedBy: principal?.kind === 'device' ? `device:${principal.deviceId ?? ''}` : principal?.kind ?? 'system',
      })
      auditRequest(c, { action: 'plugins.inputs.granted', subject: id })
      broadcastPluginsChanged()
      return { ok: true }
    })
  })
  .delete('/:id/input-grant', (c) => viaBridge(c, PLUGIN_STATE, async (bridge) => {
    const id = c.req.param('id')
    bridge.inputGrants().delete(id)
    auditRequest(c, { action: 'plugins.inputs.revoked', subject: id })
    broadcastPluginsChanged()
    return { ok: true }
  }))
  // The one exception to "nothing here starts a plugin" (docs/plugins/dev-loop.md § The dev loop § Reloading
  // one plugin without a restart). Loaded plugins only. A built-in is refused with the installer's own
  // 400 shape.
  .post('/:id/reload', async (c) => {
    const missing = requireIdempotencyKey(c)
    if (missing) return missing
    const id = c.req.param('id')
    return viaBridge(c, PLUGIN_STATE, async (bridge) => {
      const result = await asBadRequest(() => bridge.reload(id))
      // Audited like install, update and uninstall: this replaces the code a node runs, the same class
      // of decision even though no bytes arrived.
      auditRequest(c, { action: 'plugins.reloaded', subject: id, details: { state: result.state, version: result.version } })
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
      // Whether the data went with it is the part that cannot be undone, so the record has to carry it.
      auditRequest(c, { action: 'plugins.uninstalled', subject: id, details: { dataPurged: result.dataPurged } })
      broadcastPluginsChanged()
      return result
    })
  })
  // The owner's answer to an agent-raised request (docs/plugins/agent-install.md § Approval-mediated install).
  // Device-gated by the same mount as everything above it, so the agent that raised the request cannot
  // reach this route to answer its own question.
  //
  // It performs no install. The device has already done that over the routes above, with its own
  // principal. This closes the record and decides what the agent is told. No Idempotency-Key
  // requirement, because a replayed decision changes no code and the store refuses a second answer.
  .post('/requests/:requestId', async (c) => {
    const parsed = requestDecisionBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    const fallback = parsed.data.decision === 'approved' ? 'The owner approved this request.' : 'The owner declined this request.'
    const request = decidePluginRequest(c.req.param('requestId'), { decision: parsed.data.decision, message: parsed.data.message ?? fallback })
    if (!request) return respondError(c, 404, 'not_found')
    // On the same trail as install, update and uninstall, because "an agent asked and a human said yes"
    // is the decision the trail exists to hold. The agent's own sentence is not recorded: an audit row
    // that quotes untrusted text becomes a second place that text gets read as fact.
    auditRequest(c, {
      action: 'plugins.request.decided',
      subject: request.pluginId ?? request.action,
      details: { decision: parsed.data.decision, action: request.action, dev: request.dev, taskId: request.taskId },
    })
    return c.json({ ok: true })
  })
