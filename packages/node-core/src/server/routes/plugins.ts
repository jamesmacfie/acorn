import { Hono } from 'hono'
import { z } from 'zod'
import { auditRequest } from '../auditRequest'
import { routeCapability, routeCapabilityFor, setRouteTestCapability, BridgeError, viaBridge } from '../bridge'
import type { AppEnv } from '../middleware/auth'
import { respondError } from '../respond'
import type { PluginRosterEntry } from '../plugin/host'
import type { InstalledPluginInfo } from '../../main/pluginLoader'
import type { NodePluginRow } from '@acorn/protocol/api.ts'

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
  // Every package that came off disk, including the client-only ones the host never saw. Separate
  // from `roster()` because the roster describes what this PROCESS assembled, and a package with no
  // node half never enters the plugin host at all — but its bundle is exactly what phase 2
  // distributes, so it still has to appear.
  installed(): readonly InstalledPluginInfo[]
  // The client bundle's bytes, hashed at read time. Kept on the bridge rather than done in the
  // route because the file lives under the data root, which the server layer has no handle on.
  clientBundle(id: string): Promise<{ bytes: Uint8Array<ArrayBuffer>; hash: string } | null>
  // The names the owner currently has turned off, which is NOT derivable from the roster after a
  // restart-pending write: the roster describes the RUNNING process.
  disabled(): readonly string[]
  setDisabled(names: readonly string[]): void
}

export const PLUGIN_STATE = routeCapability<PluginsBridge>('core.pluginStateRoute')
/** @internal test compatibility; production providers use CapabilityRegistry.provide. */
export const setPluginsBridge = (bridge: PluginsBridge | null): void => setRouteTestCapability(PLUGIN_STATE, bridge)

const body = z.strictObject({ disabled: z.array(z.string().min(1)).max(200) })

// The running plugin set, plus the pending one. They differ exactly when a toggle has been saved and
// the node has not restarted, which is the state the UI has to render.
const state = (bridge: PluginsBridge) => {
  const pending = new Set(bridge.disabled())
  const installed = new Map(bridge.installed().map((entry) => [entry.id, entry]))
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
      },
    }
  }
  // `disabled` is what will be true after a restart; `running` is what is true now. A required plugin is
  // never disabled either way, whatever the file says.
  const rows: NodePluginRow[] = bridge.roster().map((entry) => ({
    name: entry.name,
    required: entry.required,
    disabled: !entry.required && pending.has(entry.name),
    running: !entry.disabled,
    // The outcome for THIS boot, passed through untouched. A failed row still reports
    // `running: true` on purpose — see the note on NodePluginRow about restartRequired.
    state: entry.state,
    ...(entry.failedAt === undefined ? {} : { failedAt: entry.failedAt }),
    ...declared(entry.name),
  }))
  // Client-only packages, which the plugin host never saw because there was nothing to init. Their
  // `running` deliberately tracks `disabled` exactly, so they never raise a restart banner: their
  // contributions are all client-side, and the client re-initialises its plugin host on a roster
  // change (apps/desktop client/activate.ts disposes-then-registers). A restart would change nothing.
  const known = new Set(rows.map((row) => row.name))
  for (const entry of installed.values()) {
    if (known.has(entry.id)) continue
    const off = pending.has(entry.id)
    rows.push({ name: entry.id, required: false, disabled: off, running: !off, state: off ? 'disabled' : 'active', ...declared(entry.id) })
  }
  // A restart is needed exactly where what WOULD run differs from what IS running. That covers both
  // directions: a plugin just turned off but still serving, and one turned back on that has not loaded.
  const restartRequired = rows.some((row) => !row.disabled !== row.running)
  return { plugins: rows, restartRequired }
}

export const plugins = new Hono<AppEnv>()
  .get('/', (c) => viaBridge(c, PLUGIN_STATE, async (bridge) => state(bridge)))
  // The client bundle itself (docs/third-party/phase-2-distribution-trust.md). Not viaBridge: that
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
