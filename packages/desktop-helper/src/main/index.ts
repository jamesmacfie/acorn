import type { PreviewBrowserRule, ServiceStartConfig, ServiceStartResult, ServiceState } from '@acorn/protocol/serviceProtocol.ts'
import { trustBundledClientPlugins, trustsBundledClientPlugins } from './bundledPluginTrust'
import { recordCrash } from './crashBudget'
import { deviceTokens, LOCAL_TOKEN_SCOPE, type TokenCipher } from './deviceTokenStore'
import { FleetStore, toNodeRecord } from './fleetStore'
import { NodeBroker } from './nodeBroker'
import { PluginCache } from './pluginCache'
import { PluginTrustStore } from './pluginTrustStore'
import { PreviewTunnels, type TunnelEvents } from './previewTunnel'
import { ServiceHost } from './serviceHost'

// The custody stack, composed in one place: the broker and its fleet, the device tokens, the plugin
// cache and trust store, the preview tunnels, and the supervised node service. Nothing in this
// package imports a shell binding, which is what lets it run in a process of its own: the desktop
// helper composes it under the bundled Node, and Rust supervises that (docs/shell.md § The shell
// process).
//
// What stays outside: the window, the dialogs, the renderer projection, and the encryption. Those
// reach this seam through the options below, so a shell supplies four small things and gets a warm
// broker.
//
// Boot order is the shell's to drive and matters: build the helper, register whatever the renderer
// talks to, then `start()`, then `bootComplete()`. Between start and bootComplete an unexpected exit
// is a failed boot, not a crash to recover from.

export type HelperOptions = {
  // The staged service.js, and the config it starts with. @acorn/protocol is the spec for the second
  // one, so this file does not restate its fields.
  serviceEntry: string
  service: Omit<ServiceStartConfig, 'deviceToken'>
  // Custody root: fleet.json, the encrypted device tokens, the plugin cache and the trust store. Not
  // the node's data root — that one is in `service.dataDir` and belongs to the node.
  userDataDir: string
  // How this host encrypts a device token (helper/deviceTokenStore.ts).
  tokenCipher: TokenCipher
  // Where broker pushes go. The shell owns the target, because only it knows whether a renderer is
  // currently attached.
  push: { frame(nodeId: string, frame: unknown): void; status(status: unknown): void }
  // A preview tunnel opened or closed. Only a shell that cannot inject a request header needs these:
  // the Tauri shell seeds the listener's secret into the preview webview's cookie store instead
  // (previewTunnel.ts). Electron leaves it out and keeps using `headersFor`.
  tunnelEvents?: TunnelEvents
  // The node the renderer was talking to has been replaced, by a restart or by crash recovery. Its
  // endpoint, certificate and token are all new, so whatever is rendering has to start over.
  onNodeReplaced?(): void
  // The crash budget is spent and this helper has stopped trying. The shell shows the recovery screen;
  // `retry()` is how the owner's answer comes back. Nothing else clears the block.
  onCrashBudgetExhausted(): void
}

export type Helper = {
  broker: NodeBroker
  fleet: FleetStore
  tunnels: PreviewTunnels
  pluginCache: PluginCache
  pluginTrust: PluginTrustStore
  // Start the node and adopt it into the fleet. Resolves when its migrations, bridge installation and
  // loopback listener are done; durable reconciliation continues in the background over there.
  start(): Promise<ServiceStartResult>
  // Boot succeeded. Until this is called an unexpected exit is left to the caller's error path.
  bootComplete(): void
  // Settings → Plugins' Restart button.
  restartLocalNode(): Promise<void>
  // The owner's answer to the recovery screen: forgive the spent budget and try once more.
  retry(): Promise<void>
  // Page rules for a task, as the preview pane needs them.
  previewRules(taskId: string): Promise<PreviewBrowserRule[]>
  dispose(): Promise<void>
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export function createHelper(options: HelperOptions): Helper {
  const { userDataDir } = options
  const version = options.service.version
  let disposed = false
  let booted = false
  let recovering = false
  const crashTimes: number[] = []
  const tokens = deviceTokens(userDataDir, options.tokenCipher)

  const service = new ServiceHost(options.serviceEntry, options.service, {
    stateChanged: (state: ServiceState, detail?: string) => {
      console.log(`[service-host] ${state}${detail ? `: ${detail}` : ''}`)
    },
    unexpectedExit: (code) => {
      if (!booted || disposed) return
      console.error(`[service-host] service exited unexpectedly with code ${code}`)
      void recover()
    },
  })

  const broker = new NodeBroker({ frame: options.push.frame, status: options.push.status })
  const fleet = new FleetStore(userDataDir, tokens)
  // Preview tunnels re-resolve their node from the same fleet store the broker reads on every connection,
  // so updated endpoint, token, and certificate records are applied to new connections. Established
  // pipes are torn down explicitly by restart, adoption, and forget operations.
  const tunnels = new PreviewTunnels(
    (nodeId) => {
      const node = fleet.get(nodeId)
      const token = node && fleet.tokenFor(nodeId)
      if (!node || !token) return null
      return {
        endpoint: node.endpoint,
        token,
        ...(node.certPem ? { certPem: node.certPem } : {}),
        ...(node.fingerprint ? { fingerprint: node.fingerprint } : {}),
      }
    },
    options.tunnelEvents,
  )

  // Third-party plugin bundles a node has served us, and this device's decisions about running them
  // (docs/plugins.md). Both stores are the host's: the bytes never pass through the renderer, and the
  // acknowledgements sit beside the device tokens because they are the same kind of custody, something
  // this machine agreed to, not something a node can assert.
  //
  // The sweep runs before the renderer can ask for state, so a bundle no node has offered in a month
  // is gone rather than briefly listed and then dropped.
  const pluginCache = new PluginCache(userDataDir, broker)
  pluginCache.sweep()
  const pluginTrust = new PluginTrustStore(userDataDir)
  // These exact bytes are part of the application this process is. Cache and acknowledge them locally
  // before the renderer asks for plugin state, so a node cannot turn the "bundled" label into an
  // auto-trust primitive for arbitrary remote bytes. `trustsBundledClientPlugins` owns the one
  // condition, and says why it is not "is this a packaged build".
  const { bundledPluginsDir } = options.service
  if (bundledPluginsDir && trustsBundledClientPlugins()) trustBundledClientPlugins(bundledPluginsDir, version, pluginCache, pluginTrust)

  // Record (or re-record, after a crash restart) the local node and bring its connection up. The
  // endpoint, the certificate and even the token can change between starts now that the port is
  // ephemeral, so this is driven by each start result rather than cached. The label stays the owner's
  // though, so a rename survives.
  const adoptLocalNode = (started: ServiceStartResult): void => {
    // Every start (first boot, crash recovery, a deliberate restart) can change the endpoint, the
    // certificate and the token, so any surviving pipe to this node is pointed at a process that is
    // gone.
    tunnels.closeFor({ nodeId: started.nodeId })
    const node = fleet.remember(
      {
        nodeId: started.nodeId,
        label: fleet.get(started.nodeId)?.label ?? 'This computer',
        endpoint: started.endpoint.origin,
        local: true,
        ...(started.fingerprint ? { fingerprint: started.fingerprint } : {}),
        ...(started.certPem ? { certPem: started.certPem } : {}),
      },
      started.deviceToken,
    )
    broker.upsert({
      ...toNodeRecord(node),
      token: started.deviceToken,
      ...(node.certPem ? { certPem: node.certPem } : {}),
    })
  }

  // Start the service and persist whatever token it ended up using. Reused on every start, including
  // crash recovery: a restart must not mint a new device row, and the endpoint can change across
  // restarts, so the caller always takes the fresh result rather than caching the first one.
  const start = async (): Promise<ServiceStartResult> => {
    const started = await service.start(tokens.read(LOCAL_TOKEN_SCOPE))
    adoptLocalNode(started)
    return started
  }

  // Settings → Plugins' Restart button. Only the local node has one: a remote node is somebody else's
  // process and this client has no business restarting it.
  //
  // Goes through the same `start` as boot and crash recovery, so the node re-reads its
  // disabled-plugins file on the way up, and `adoptLocalNode` re-records the endpoint, certificate,
  // and token, since all three can change across a restart now that the port is ephemeral. Not routed
  // through `recover()`: this is a restart the owner asked for, and spending one of the five crashes
  // in the ten-minute budget on it would mean a few plugin toggles could trip the recovery screen.
  // Guarded against `recover()`, which is the case that made this dangerous rather than merely racy.
  //
  // `ServiceHost.start` throws "already started" while a child exists. Without the guard: the service
  // crashes, `recover()` is inside its backoff wait, the owner clicks Restart, Restart succeeds, and
  // then `recover()`'s own `start()` throws. Its catch calls `service.stop()` and kills the working
  // node, then re-enters `recover()` and spends another crash from the budget. Two clicks during
  // recovery tripped the recovery dialog on a healthy node.
  //
  // A failure here also has to reach `recover()`, not just the caller: if `start()` rejects (a taken
  // port, a corrupt plugin DB) no child was ever spawned, so `unexpectedExit` never fires and the app
  // would sit with a dead node until relaunch. It still reports to the caller, so Settings → Plugins
  // shows the reason.
  const restartLocalNode = async (): Promise<void> => {
    if (disposed) return
    if (recovering) throw new Error('acorn is already restarting the background service.')
    recovering = true
    // A pipe to the process we are about to kill is dead either way, and its endpoint is about to change.
    tunnels.closeFor({})
    try {
      await service.stop()
      await start()
      options.onNodeReplaced?.()
    } catch (error) {
      recovering = false
      void recover()
      throw error
    }
    recovering = false
  }

  // Crash budget and restart backoff: docs/shell.md § Node child.
  const recover = async (): Promise<void> => {
    if (recovering || disposed) return
    recovering = true
    // The budget arithmetic is in crashBudget.ts, where it can be tested without booting a shell and
    // crashing a real service five times.
    const decision = recordCrash(crashTimes, Date.now())
    // Left blocked on purpose: `recovering` stays true until `retry()` clears it, so nothing restarts
    // behind the recovery screen.
    if (!decision.retry) return void options.onCrashBudgetExhausted()
    try {
      await wait(decision.delayMs)
      await start()
      options.onNodeReplaced?.()
      console.log('[service-host] background service recovered')
    } catch (error) {
      console.error('[service-host] recovery failed:', error)
      await service.stop()
      recovering = false
      void recover()
      return
    }
    recovering = false
  }

  return {
    broker,
    fleet,
    tunnels,
    pluginCache,
    pluginTrust,
    start,
    bootComplete: () => {
      booted = true
    },
    restartLocalNode,
    // Clear the budget so the next failure gets the full backoff again. The owner asking for a retry is
    // new information: they may have just freed the port or fixed permissions.
    retry: async () => {
      crashTimes.length = 0
      recovering = false
      await recover()
    },
    previewRules: (taskId) => service.previewRules(taskId),
    dispose: async () => {
      if (disposed) return
      disposed = true
      await service.stop()
      tunnels.dispose()
      broker.dispose()
    },
  }
}
