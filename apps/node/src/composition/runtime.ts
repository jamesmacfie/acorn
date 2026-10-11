import { dirname } from 'node:path'
import { ACORN_BASELINE } from '@acorn/protocol/baseline.ts'
import type { ServiceStartConfig, ServiceStartResult, ServiceState } from '@acorn/protocol/serviceProtocol.ts'
import { resolveDeviceToken } from '@acorn/node-core/server/auth'
import { openDataRoot } from '@acorn/node-core/server/storage'
import { launcherSpec, serverName } from '@acorn/node-core/server/mcpRegister.ts'
import type { PreviewBrowserRule } from '@acorn/protocol/serviceProtocol.ts'
import { PREVIEW_RULES } from '@acorn/plugin-preview/contract/rules.ts'
import { bootNode } from './boot'

export type ServiceRuntime = {
  previewRules(taskId: string): Promise<PreviewBrowserRule[]>
  stop(): Promise<void>
  // What the parent needs to reach this node: where it bound, who it is, and the bearer to use.
  // Reported rather than assumed, so a second node on the same machine is just another endpoint.
  started: ServiceStartResult
}

type RuntimeOptions = {
  config: ServiceStartConfig
  stateChanged(state: ServiceState, detail?: string): void
}

// The Node the desktop helper supervises (docs/architecture-overview.md § Process ownership). The boot
// itself is bootNode's (./boot.ts). What this adds is the supervised host's own work: state reports
// over the service channel, the installed-bytes report, and the preview rules the helper asks for.
export async function startServiceRuntime({ config, stateChanged }: RuntimeOptions): Promise<ServiceRuntime> {
  stateChanged('migrating')
  let node: Awaited<ReturnType<typeof bootNode>>
  try {
    node = await bootNode({
      // Mints/reads the nodeId and takes the root's exclusive lock. A second node on the same root
      // fails here with an actionable message rather than corrupting it.
      root: openDataRoot(config.dataDir),
      appVersion: config.version,
      keys: config.keys,
      bundledPluginsDir: config.bundledPluginsDir,
      development: !config.isPackaged,
      // The persisted list unioned with the start config's (docs/node-distribution.md § Plugins): the
      // file is the only form a remote node has, and the start config stays a test override.
      disabledPlugins: config.disabledPlugins,
      loginShellPath: config.isPackaged,
      mcp: {
        name: serverName(config.isPackaged),
        launcher: launcherSpec(config.hostRuntimePath, config.mcpEntry, serverName(config.isPackaged)),
      },
    })
  } catch (error) {
    stateChanged('failed', error instanceof Error ? error.message : String(error))
    throw error
  }
  stateChanged('listening')

  let stopped = false
  let stopInstalledBytes = () => {}
  let stopping: Promise<void> | null = null
  const stop = (): Promise<void> => (stopping ??= (async () => {
    stopped = true
    stateChanged('draining')
    stopInstalledBytes()
    await node.stop()
    stateChanged('stopped')
  })())

  // The app's shipped and installed bytes, once, a minute after boot (node-core
  // server/telemetry/installedBytes.ts). Only the desktop app hands over its resource directory, as
  // the parent of its bundled plugins, so a standalone node reports nothing here. Imported here
  // rather than at the top, so the walker stays out of the service's startup graph.
  const bundledPluginsDir = config.bundledPluginsDir
  if (bundledPluginsDir) {
    void import('@acorn/node-core/server/telemetry/installedBytes').then(({ scheduleInstalledBytesReport }) => {
      if (stopped) return
      stopInstalledBytes = scheduleInstalledBytesReport({
        resourceRoot: dirname(bundledPluginsDir),
        release: config.version,
        packaged: config.isPackaged,
        nativeRuntime: config.hostRuntimePath,
        excludedRoots: [config.dataDir],
      })
    })
  }

  stateChanged('reconciling')
  void node.reconciled.then(() => { if (!stopped) stateChanged('ready') })

  try {
    return {
      // preview's one node-side read, resolved through its capability at call time rather than wired
      // as a query. `[]` when the plugin is disabled is the right answer, not a degradation: with no
      // preview plugin there are no page rules to report, and an empty list is already the "none
      // configured" case the browser automation handles.
      previewRules: async (taskId) => (await node.runtime.CAPABILITIES.get(PREVIEW_RULES)?.forTask(taskId)) ?? [],
      stop,
      started: {
        baseline: ACORN_BASELINE,
        state: 'listening',
        nodeId: node.runtime.NODE_ID,
        endpoint: node.listener.endpoint,
        fingerprint: node.listener.fingerprint,
        certPem: node.listener.certPem,
        // The local bundle pairs without a code: the client spawned this node, proof enough of owner
        // intent (docs/authentication.md § Pairing). The client passes back the token it remembered
        // from the OS keychain, and resolveDeviceToken reuses it while it still authenticates, so the
        // steady state is one device row per install rather than one per launch. The service never
        // persists it; custody stays with the client.
        deviceToken: await resolveDeviceToken(node.runtime.DEVICES, config.deviceToken, 'This computer'),
        keyCheck: node.keyCheck,
      },
    }
  } catch (error) {
    stateChanged('failed', error instanceof Error ? error.message : String(error))
    await stop()
    throw error
  }
}
