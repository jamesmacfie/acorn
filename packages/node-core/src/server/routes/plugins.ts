import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { auditRequest } from '../auditRequest'
import { routeCapability, routeCapabilityFor, setRouteTestCapability, BridgeError, viaBridge } from '../bridge'
import type { AppEnv } from '../middleware/auth'
import { respondError } from '../respond'
import type { PluginRosterEntry } from '../plugin/host'
import type { InstalledPluginInfo } from '../../main/pluginLoader'
import type {
  NodePluginRow,
  PluginInstallResult,
  PluginInstallSource,
  PluginUninstallResult,
  PluginUpdateResult,
} from '@acorn/protocol/api.ts'

// Which plugins this node runs, and the owner's toggle (docs/ui-design.md § New surfaces, "Settings →
// Plugins"). A bridge rather than a direct read, because the roster only exists once the composition
// root has run the plugin host, and the persisted list is a file in the data root rather than a table —
// both live one layer above the server (main/disabledPlugins.ts).
//
// `restartRequired` is honest rather than clever: a plugin's routes, tables and jobs are wired at init,
// so nothing short of a restart can add or remove them. plugins.md says the same ("disabling
// unregisters contributions at next startup"), and the alternative — re-running the host in a live
// process — would have to tear down SQLite handles under in-flight requests.
export type PluginsBridge = {
  roster(): readonly PluginRosterEntry[]
  // Every package on disk RIGHT NOW, including the client-only ones the host never saw. Separate
  // from `roster()` because the roster describes what this PROCESS assembled, and a package with no
  // node half never enters the plugin host at all — but its bundle is exactly what phase 2
  // distributes, so it still has to appear.
  //
  // Re-read per call rather than snapshotted at boot: after an install or an uninstall the two answers
  // differ, and that difference IS the pending state this route reports.
  installed(): readonly InstalledPluginInfo[]
  // What this process actually loaded, at the version it loaded. The counterpart to `installed()`, and
  // the only way to tell "installed and running" from "installed since the last restart".
  booted(): readonly { id: string; version: string }[]
  // The client bundle's bytes, hashed at read time. Kept on the bridge rather than done in the
  // route because the file lives under the data root, which the server layer has no handle on.
  clientBundle(id: string): Promise<{ bytes: Uint8Array<ArrayBuffer>; hash: string } | null>
  // The names the owner currently has turned off, which is NOT derivable from the roster after a
  // restart-pending write: the roster describes the RUNNING process.
  disabled(): readonly string[]
  setDisabled(names: readonly string[]): void
  // The installer (main/pluginInstaller.ts), reached the same way everything else here is: it needs the
  // data root, which the server layer has no handle on. Each throws a plain Error carrying a sentence
  // for the owner; the handlers turn that into one 400.
  install(source: PluginInstallSource, options: { allowDowngrade?: boolean }): Promise<PluginInstallResult>
  update(id: string, options: { allowDowngrade?: boolean }): Promise<PluginUpdateResult>
  uninstall(id: string, options: { purgeData?: boolean }): PluginUninstallResult
}

export const PLUGIN_STATE = routeCapability<PluginsBridge>('core.pluginStateRoute')
/** @internal test compatibility; production providers use CapabilityRegistry.provide. */
export const setPluginsBridge = (bridge: PluginsBridge | null): void => setRouteTestCapability(PLUGIN_STATE, bridge)

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

// The running plugin set, plus the pending one. They differ exactly when a toggle has been saved and
// the node has not restarted, which is the state the UI has to render.
const state = (bridge: PluginsBridge) => {
  const pending = new Set(bridge.disabled())
  const installed = new Map(bridge.installed().map((entry) => [entry.id, entry]))
  // What this process loaded, at the version it loaded. A package on disk that is absent here, or here
  // at a different version, arrived after the last start; one here but no longer on disk was
  // uninstalled and is still serving. Both are the same answer for the owner: restart.
  const booted = new Map(bridge.booted().map((entry) => [entry.id, entry.version]))
  const stale = (id: string): boolean => {
    const running = booted.get(id)
    const onDisk = installed.get(id)?.version
    if (!onDisk) return running !== undefined
    return running !== onDisk
  }
  // Present only for a package that came off disk. A built-in's version is the app's, and it has no
  // manifest and no bundle to distribute, so the whole block is absent rather than filled with nulls.
  const declared = (name: string): Pick<NodePluginRow, 'installed'> => {
    const entry = installed.get(name)
    if (!entry) return {}
    return {
      installed: {
        version: entry.version,
        apiVersion: entry.apiVersion,
        permissions: entry.permissions,
        contributions: entry.contributions,
        client: entry.client,
        ...(entry.source === undefined ? {} : { source: entry.source }),
        ...(entry.installedAt === undefined ? {} : { installedAt: entry.installedAt }),
      },
    }
  }
  // `disabled` is what will be true after a restart; `running` is what is true now. A required plugin is
  // never disabled either way, whatever the file says.
  const rows: NodePluginRow[] = bridge.roster().map((entry) => ({
    name: entry.name,
    required: entry.required,
    disabled: !entry.required && pending.has(entry.name),
    // An uninstalled-but-still-serving plugin is genuinely running; a plugin whose directory changed
    // under it is running the OLD code. Either way `running` describes this process, and `state` is what
    // says the disk has moved on.
    running: !entry.disabled,
    // The outcome for THIS boot, passed through untouched — except that a package the disk no longer
    // agrees with outranks it. A failed row still reports `running: true` on purpose (see the note on
    // NodePluginRow), and 'failed' is deliberately NOT overridden: a restart cannot fix a plugin whose
    // init throws, so it must not raise the banner even if its directory also changed.
    state: entry.state === 'failed' ? 'failed' : stale(entry.name) ? 'pending-restart' : entry.state,
    ...(entry.failedAt === undefined ? {} : { failedAt: entry.failedAt }),
    ...declared(entry.name),
  }))
  // Packages the plugin host never saw. Two kinds, and they are not the same answer:
  //
  //   client-only — nothing to init, ever. `running` tracks `disabled` exactly so it never raises a
  //     restart banner: its contributions are all client-side, and the client re-initialises its plugin
  //     host on a roster change (apps/desktop client/activate.ts disposes-then-registers).
  //   just installed — it HAS a node half that this process never loaded. Not running, and a restart is
  //     exactly what makes it run.
  const known = new Set(rows.map((row) => row.name))
  for (const entry of installed.values()) {
    if (known.has(entry.id)) continue
    const off = pending.has(entry.id)
    const waiting = entry.hasNode && !off && booted.get(entry.id) !== entry.version
    rows.push({
      name: entry.id,
      required: false,
      disabled: off,
      running: !off && !waiting,
      state: off ? 'disabled' : waiting ? 'pending-restart' : 'active',
      ...declared(entry.id),
    })
  }
  // A restart is needed exactly where what WOULD run differs from what IS running. That covers the
  // toggle in both directions — a plugin just turned off but still serving, one turned back on that has
  // not loaded — and, since phase 5, every way the install directory can disagree with this process.
  const restartRequired = rows.some((row) => !row.disabled !== row.running || row.state === 'pending-restart')
  return { plugins: rows, restartRequired }
}

export const plugins = new Hono<AppEnv>()
  .get('/', (c) => viaBridge(c, PLUGIN_STATE, async (bridge) => state(bridge)))
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
      return state(bridge)
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
