import { createEffect, createRoot, onCleanup } from 'solid-js'
import type { QueryClient } from '@tanstack/solid-query'
import type { DeviceConfig } from '@acorn/protocol/deviceConfig.ts'
import type { PostedTelemetryRuntime } from '@acorn/protocol/telemetry.ts'
import { watchConnectionChanges } from '../features/integrations/watchConnectionChanges'
import { initSystemNotices, initWorkflowNotices } from '../features/notifications/deliver'
import { watchProjectChanges } from '../features/projects/watchProjectChanges'
import { taskStatusScheduleContribution } from '../features/tasks/taskStatus'
import { watchTaskChanges } from '../features/tasks/watchTaskChanges'
import { watchWorkspaceChanges } from '../features/workspaces/watchWorkspaceChanges'
import { nodeReady } from '../infra/node/activeNode'
import { watchNodeEvents } from '../infra/node/watchNodeEvents'
import { startDeviceConfigSync } from '../infra/persistence/deviceConfigSync'
import { startClientTelemetry } from '../infra/telemetry/emitter'
import { postTelemetryBatch } from '../infra/telemetry/post'
import { watchPluginChanges } from './plugins/reload'
import { clientScheduleRegistry, startClientSchedules } from './registries/shell/schedules'

// Everything a client host starts the same way, in one call. The desktop renderer
// (apps/desktop/src/client/index.tsx) and the terminal client (apps/tui/src/main.tsx) each call this
// once and keep only their own work: responsiveness, page facts, links and sound on the desktop;
// plugin workers, the roster and the bell in the terminal.
//
// Telemetry is wired here but stays off until the shell reads `telemetry.enabled` off the node
// (docs/telemetry/model.md § The switch), so a host must call this before it draws, not before
// anything else runs.

export type ClientRuntimeHost = {
  /** Which runtime this client's telemetry records name. */
  runtime: PostedTelemetryRuntime
  /** The query cache that preferences from the device config file are saved into. */
  client: () => QueryClient
  /** Called with each device config the file supplies, before its preferences are saved. */
  onDeviceConfig?: (config: DeviceConfig) => void
  /** Settles once loaded plugin bundles can register on this host. The plugin watcher's first pass
   *  waits for it. The terminal needs its worker factory first; the desktop has nothing to wait for. */
  pluginsReady?: Promise<void>
}

/** Starts the shared runtime and resolves once the device config file has been applied, with the
 *  one function that stops all of it. */
export async function startClientRuntime(host: ClientRuntimeHost): Promise<() => void> {
  startClientTelemetry({ runtime: host.runtime, post: postTelemetryBatch(host.runtime) })

  const stops: (() => void)[] = [
    // Each node broadcast that invalidates a cached list or re-emits on the client bus
    // (docs/plugins/events.md § Hearing a core event).
    watchTaskChanges(),
    watchConnectionChanges(),
    watchProjectChanges(),
    watchWorkspaceChanges(),
    watchNodeEvents(),
    // Workflow notices arrive over `/v1/events` from the node itself, not from the terminal plugin,
    // so a node without a terminal still raises them. The system channel is an OS banner on the
    // desktop and an escape sequence in a terminal (`showNotification` in infra/platform).
    initWorkflowNotices(),
    initSystemNotices(),
    clientScheduleRegistry.register(taskStatusScheduleContribution).dispose,
    startSchedulesWhenNodeReady(),
  ]

  // Third-party plugin bundles across the whole fleet. The watcher runs its first pass when a node
  // first becomes reachable and reconciles whenever one reloads a plugin (docs/plugins/dev-loop.md).
  let stopped = false
  void (host.pluginsReady ?? Promise.resolve()).then(() => {
    if (!stopped) stops.push(watchPluginChanges())
  })

  stops.push(await startDeviceConfigSync(host.client, host.onDeviceConfig))
  return () => {
    stopped = true
    for (const stop of stops.splice(0).reverse()) stop()
  }
}

// Each schedule runs once when it starts, then waits for its interval or an event. Started before the
// node can answer, that first run fails and leaves task statuses empty for up to 10 s and workflow run
// counts for up to 2 min. Started once and kept, because the startup gate can briefly hold again while
// Settings → Nodes re-reads the fleet, and `startClientSchedules` already follows node switches.
function startSchedulesWhenNodeReady(): () => void {
  return createRoot((dispose) => {
    let stopSchedules: (() => void) | undefined
    createEffect(() => {
      if (!stopSchedules && nodeReady()) stopSchedules = startClientSchedules()
    })
    onCleanup(() => stopSchedules?.())
    return dispose
  })
}
