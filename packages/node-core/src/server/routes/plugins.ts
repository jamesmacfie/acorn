import { Hono } from 'hono'
import { z } from 'zod'
import { bridgeSlot, BridgeError, viaBridge } from '../bridge'
import type { AppEnv } from '../middleware/auth'
import { respondError } from '../respond'
import type { PluginRosterEntry } from '../plugin/host'

// Which plugins this node runs, and the owner's toggle (docs/vNext/ui.md § New surfaces, "Settings →
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
  // The names the owner currently has turned off, which is NOT derivable from the roster after a
  // restart-pending write: the roster describes the RUNNING process.
  disabled(): readonly string[]
  setDisabled(names: readonly string[]): void
}

export const pluginsBridgeSlot = bridgeSlot<PluginsBridge>()
export const setPluginsBridge = pluginsBridgeSlot.set

const body = z.strictObject({ disabled: z.array(z.string().min(1)).max(200) })

// The running plugin set, plus the pending one. They differ exactly when a toggle has been saved and
// the node has not restarted, which is the state the UI has to render.
const state = (bridge: PluginsBridge) => {
  const pending = new Set(bridge.disabled())
  // `disabled` is what will be true after a restart; `running` is what is true now. A required plugin is
  // never disabled either way, whatever the file says.
  const rows = bridge.roster().map((entry) => ({
    name: entry.name,
    required: entry.required,
    disabled: !entry.required && pending.has(entry.name),
    running: !entry.disabled,
  }))
  // A restart is needed exactly where what WOULD run differs from what IS running. That covers both
  // directions: a plugin just turned off but still serving, and one turned back on that has not loaded.
  const restartRequired = rows.some((row) => !row.disabled !== row.running)
  return { plugins: rows, restartRequired }
}

export const plugins = new Hono<AppEnv>()
  .get('/', (c) => viaBridge(c, pluginsBridgeSlot, async (bridge) => state(bridge)))
  .put('/', async (c) => {
    const parsed = body.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, pluginsBridgeSlot, async (bridge) => {
      const known = new Map(bridge.roster().map((entry) => [entry.name, entry]))
      // Both rejections are 400 rather than a silent filter. A typo'd name that vanished would leave the
      // owner looking at a checkbox that would not stick and no explanation; a `required` name silently
      // dropped would do the same, and the client already knows which rows are not togglable.
      for (const name of parsed.data.disabled) {
        const entry = known.get(name)
        if (!entry) throw new BridgeError(400, 'bad_request', `Unknown plugin: ${name}`)
        if (entry.required) throw new BridgeError(400, 'bad_request', `${name} is a required plugin and cannot be disabled.`)
      }
      bridge.setDisabled(parsed.data.disabled)
      return state(bridge)
    })
  })
