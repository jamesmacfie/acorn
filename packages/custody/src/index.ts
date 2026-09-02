import type { PreviewBrowserRule, ServiceStartConfig, ServiceStartResult, ServiceState } from '@acorn/protocol/serviceProtocol.ts'
import { helperMark } from './bootMarks'
import { trustBundledClientPlugins, trustsBundledClientPlugins } from './plugins/bundledPluginTrust'
import { recordCrash } from './supervision/crashBudget'
import { deviceTokens, LOCAL_TOKEN_SCOPE, type TokenCipher } from './custody/deviceTokenStore'
import { FleetStore, toNodeRecord } from './broker/fleetStore'
import { NodeBroker } from './broker/nodeBroker'
import { PluginCache } from './plugins/pluginCache'
import { PluginTrustStore } from './plugins/pluginTrustStore'
import { PreviewTunnels, type TunnelEvents } from './supervision/previewTunnel'
import { ServiceHost } from './supervision/serviceHost'

// The custody stack, composed in one place: the broker and its fleet, the device tokens, the plugin
// cache and trust store, the preview tunnels, and the supervised node service. Nothing here imports a
// shell binding, which is what lets it run in a process of its own. See docs/shell.md, "The shell
// process".
//
// The window, the dialogs, the renderer projection, and the encryption stay outside and reach this
// seam through the options below.
//
// The shell drives boot order: build the helper, register whatever the renderer talks to, then
// `bootComplete()`, then start the node. The desktop starts it with `startInBackground()` so the
// window opens on the helper listening rather than on the node being up
// (docs/future/performance/decisions.md § Every host draws first). A host that has a reason to wait
// still awaits `start()`, and until `bootComplete()` an unexpected exit is a failed boot rather than
// a crash to recover from.

export type HelperOptions = {
  // The staged service.js, and the config it starts with. @acorn/protocol specs the config.
  serviceEntry: string
  service: Omit<ServiceStartConfig, 'deviceToken'>
  // Custody root: fleet.json, the encrypted device tokens, the plugin cache and the trust store. The
  // node's own data root is `service.dataDir`.
  userDataDir: string
  // How this host encrypts a device token (helper/deviceTokenStore.ts).
  tokenCipher: TokenCipher
  // Where broker pushes go. The shell owns the target, because only it knows whether a renderer is
  // currently attached.
  // `bytes` is the one binary channel: terminal output, id-tagged (@acorn/protocol/ws.ts § The one
  // binary frame).
  push: { frame(nodeId: string, frame: unknown): void; bytes(nodeId: string, frame: Uint8Array): void; status(status: unknown): void }
  // A preview tunnel opened or closed. Only a shell that cannot inject a request header needs these.
  // The Tauri shell seeds the listener's secret into the preview webview's cookie store instead. See
  // previewTunnel.ts.
  tunnelEvents?: TunnelEvents
  // A restart or crash recovery replaced the node the renderer was talking to. Its endpoint,
  // certificate, and token are all new, so whatever is rendering has to start over.
  onNodeReplaced?(): void
  // The crash budget is spent and this helper has stopped trying. The shell shows the recovery
  // screen, and `retry()` carries the owner's answer back. Nothing else clears the block. `reason` is
  // why the last attempt failed, when the service said anything, and the recovery screen is the only
  // place an owner sees it.
  onCrashBudgetExhausted(reason?: string): void
}

export type Helper = {
  broker: NodeBroker
  fleet: FleetStore
  tunnels: PreviewTunnels
  pluginCache: PluginCache
  pluginTrust: PluginTrustStore
  // Start the node and adopt it into the fleet. Resolves when its migrations, bridge installation,
  // and loopback listener are done. Durable reconciliation continues in the background over there.
  start(): Promise<ServiceStartResult>
  // The same start, for a caller that has already opened its window and has nowhere to report a
  // rejection to. A rejected `start()` never spawned a child, so `unexpectedExit` cannot fire and
  // nothing else would ever retry — this routes that case into the crash budget and the recovery
  // dialog a later crash reaches. Call `bootComplete()` first, or the first exit is read as a failed
  // boot and ignored.
  startInBackground(): void
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

  // Why the last start attempt failed, for the recovery screen. `start()` resets it so a fixed
  // problem is not reported as the cause of a later one.
  let lastFailure: string | undefined

  const service = new ServiceHost(options.serviceEntry, options.service, {
    stateChanged: (state: ServiceState, detail?: string) => {
      console.log(`[service-host] ${state}${detail ? `: ${detail}` : ''}`)
      if (state === 'failed' && detail) lastFailure = detail
    },
    unexpectedExit: (code) => {
      if (!booted || disposed) return
      console.error(`[service-host] service exited unexpectedly with code ${code}`)
      // Only if the service did not already say why. Its own message beats an exit code.
      lastFailure ??= `the background service exited with code ${code}`
      void recover()
    },
  })

  const broker = new NodeBroker({ frame: options.push.frame, bytes: options.push.bytes, status: options.push.status })
  const fleet = new FleetStore(userDataDir, tokens)
  // Preview tunnels re-resolve their node from the fleet store on every connection, so a new
  // endpoint, token, or certificate applies to new connections. Restart, adoption, and forget tear
  // down established pipes explicitly.
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

  // Third-party plugin bundles a node has served, and this device's decisions about running them. See
  // docs/plugins.md. Both stores belong to the host: the bytes never pass through the renderer, and
  // the acknowledgements sit beside the device tokens because they are the same kind of custody,
  // something this machine agreed to rather than something a node can assert.
  //
  // The sweep runs before the renderer can ask for state, so a bundle no node has offered in a month
  // is gone rather than briefly listed and then dropped.
  const pluginCache = new PluginCache(userDataDir, broker)
  pluginCache.sweep()
  helperMark('plugin-cache sweep')
  const pluginTrust = new PluginTrustStore(userDataDir)
  // These bytes ship with this process. Cache and acknowledge them locally before the renderer asks
  // for plugin state, so a node cannot turn the "bundled" label into auto-trust for arbitrary remote
  // bytes. `trustsBundledClientPlugins` owns the one condition.
  const { bundledPluginsDir } = options.service
  if (bundledPluginsDir && trustsBundledClientPlugins()) trustBundledClientPlugins(bundledPluginsDir, version, pluginCache, pluginTrust)
  helperMark('bundled plugins trusted')

  // Record, or re-record after a crash restart, the local node and bring its connection up. The port
  // is ephemeral, so the endpoint, the certificate, and the token can all change between starts. Each
  // start result drives this rather than a cache. The label stays the owner's, so a rename survives.
  const adoptLocalNode = (started: ServiceStartResult): void => {
    // Any surviving pipe to this node points at a process that is gone.
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
  // crash recovery, because a restart must not mint a new device row. The caller always takes the
  // fresh result, since the endpoint can change across restarts.
  const start = async (): Promise<ServiceStartResult> => {
    lastFailure = undefined
    const started = await service.start(tokens.read(LOCAL_TOKEN_SCOPE))
    // The node's own `[service:boot]` lines land in front of this one, so the two accounts read as one
    // timeline: everything the node printed, then how long the helper waited for all of it.
    helperMark('service.start')
    adoptLocalNode(started)
    helperMark('node adopted')
    return started
  }

  // Settings > Plugins' Restart button. Only the local node has one, because a remote node is
  // somebody else's process.
  //
  // Goes through the same `start` as boot and crash recovery, so the node re-reads its
  // disabled-plugins file on the way up and `adoptLocalNode` re-records the endpoint, certificate,
  // and token. It skips `recover()`, because the owner asked for this restart and spending one of the
  // five crashes in the ten-minute budget would let a few plugin toggles trip the recovery screen.
  //
  // The `recovering` guard matters. `ServiceHost.start` throws "already started" while a child
  // exists, so without it: the service crashes, `recover()` waits out its backoff, the owner clicks
  // Restart, Restart succeeds, and `recover()`'s own `start()` throws. Its catch calls
  // `service.stop()`, kills the working node, re-enters `recover()`, and spends another crash. Two
  // clicks during recovery tripped the recovery dialog on a healthy node.
  //
  // A failure here also has to reach `recover()`. If `start()` rejects on a taken port or a corrupt
  // plugin DB, no child was ever spawned, so `unexpectedExit` never fires and the app sits with a
  // dead node until relaunch. It still reports to the caller, so Settings > Plugins shows the
  // reason.
  const restartLocalNode = async (): Promise<void> => {
    if (disposed) return
    if (recovering) throw new Error('acorn is already restarting the background service.')
    recovering = true
    // A pipe to the process about to be killed is dead either way.
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

  // Crash budget and restart backoff. See docs/shell.md, "Node child".
  const recover = async (): Promise<void> => {
    if (recovering || disposed) return
    recovering = true
    // The budget arithmetic is in crashBudget.ts, where it can be tested without crashing a real
    // service five times.
    const decision = recordCrash(crashTimes, Date.now())
    // Left blocked on purpose. `recovering` stays true until `retry()` clears it, so nothing restarts
    // behind the recovery screen.
    if (!decision.retry) return void options.onCrashBudgetExhausted(lastFailure)
    try {
      await wait(decision.delayMs)
      await start()
      options.onNodeReplaced?.()
      console.log('[service-host] background service recovered')
    } catch (error) {
      console.error('[service-host] recovery failed:', error)
      // A rejected `start()` never spawned a child, so no state event carried a reason. This is the
      // taken-port and locked-data-root case, the one worth naming on the screen.
      lastFailure ??= error instanceof Error ? error.message : String(error)
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
    // The desktop's boot path (docs/shell.md § The shell process). The window is already open, so the
    // only place a failure can be reported is the recovery dialog, and the only thing that can put it
    // there is `recover()`. Its own guards make a double entry harmless: a child that spawned and then
    // died reaches `recover()` through `unexpectedExit` as well, and the second call returns at the
    // `recovering` check.
    startInBackground: () => {
      void start().catch((error: unknown) => {
        console.error('[service-host] the background service did not start:', error)
        lastFailure ??= error instanceof Error ? error.message : String(error)
        void recover()
      })
    },
    bootComplete: () => {
      booted = true
    },
    restartLocalNode,
    // Clear the budget so the next failure gets the full backoff again. A retry is new information:
    // the owner may have freed the port or fixed permissions.
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
