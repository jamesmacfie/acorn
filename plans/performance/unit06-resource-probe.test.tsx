// Investigation harness, outside source. Hooks are supplied at the host boundary; PluginFrame,
// its bridge, appearance observer, event bus, and services are the shipped implementation.
import { it, vi } from 'vitest'
import { render } from 'solid-js/web'
import { For, createComponent, createRoot, createRenderEffect, getOwner, onCleanup } from 'solid-js'
import { writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/solid-query'
import { createComponent as webCreateComponent } from 'solid-js/web'
import { expect } from 'vitest'
vi.mock('@solidjs/router', () => ({ useNavigate: () => () => {} }))
import PluginFrame from 'unit06-core/host/frames/PluginFrame'
import { clientEvents } from 'unit06-core/host/registries/commands/clientEvents'
import { _seedPluginDistribution, _resetPluginDistribution } from 'unit06-core/host/plugins/distribution'
import { syncPluginContributions } from 'unit06-core/host/plugins/syncContributions'
import { _resetFrameContributions } from 'unit06-core/host/frames/register'
import { _resetChromeContributions } from 'unit06-core/host/chrome/chromeRegister'
import { paneRegistry } from 'unit06-core/host/registries/panes/panes'
import { PLUGIN_API_MAJOR } from '../../packages/protocol/src/plugin/apiVersion'
const evidenceTag = process.env.ACORN_PERF_TAG ?? 'sample'

class Port {
  onmessage: ((event: { data: unknown }) => void) | null = null
  posted: any[] = []
  closed = false
  start() {}
  close() { this.closed = true }
  postMessage(data: any) { this.posted.push(data) }
}
const channels: { port1: Port; port2: Port }[] = []
class Channel {
  port1 = new Port()
  port2 = new Port()
  constructor() { channels.push(this) }
}
const flush = async () => { await new Promise((resolve) => setTimeout(resolve, 0)) }
it('measures frame cleanup after native load event and repeated pane disposal', async () => {
  vi.stubGlobal('MessageChannel', Channel)
  const closeWebview = vi.fn()
  const warnings: unknown[][] = []
  const warn = vi.spyOn(console, 'warn').mockImplementation((...args) => warnings.push(args))
  const checkpoints = []
  expect(createComponent).toBe(webCreateComponent)
  let constructions = 0, cleanups = 0
  let loadOwner: unknown = 'not run'
  for (let i = 0; i < 40; i++) {
    const host = document.createElement('div')
    document.body.append(host)
    const qc = new QueryClient()
    const owner = () => {
      constructions++; expect(useQueryClient()).toBe(qc); onCleanup(() => cleanups++)
      return <PluginFrame hash={'a'.repeat(64)} binding={{
      pluginId: 'audit', surface: 'audit.pane', target: 'pane', nodeId: 'synthetic', taskId: 'task',
      api: [], events: ['runtime:task-archived'], panes: [], claimsKeys: [],
    }} webview={{ navigate: async () => true, command: async () => true, subscribe: () => closeWebview }} />
    }
    const dispose = render(() => <QueryClientProvider client={qc}>{createComponent(owner, {})}</QueryClientProvider>, host)
    const iframe = host.querySelector('iframe')!
    iframe.contentWindow!.postMessage = () => {}
    iframe.addEventListener('load', () => { loadOwner = getOwner() })
    iframe.dispatchEvent(new Event('load'))
    const channel = channels.at(-1)!
    // A real bridge receives the first message and subscribes through the real services/event bus.
    channel.port1.onmessage!({ data: { id: 1, kind: 'subscribe', channel: 'runtime:task-archived' } })
    dispose()
    host.remove()
    qc.clear()
    if ([0, 9, 39].includes(i)) {
      const beforePush = channels.reduce((sum, channel) => sum + channel.port1.posted.length, 0)
      clientEvents.emit('plugin:surface-action', { pluginId: 'audit', surface: 'audit.pane', command: 'audit.test' })
      clientEvents.emit('runtime:task-archived', { taskId: 'task' })
      document.documentElement.dataset.theme = 'audit-' + i
      await flush()
      checkpoints.push({ opens: i + 1, closedPorts: channels.filter((channel) => channel.port1.closed).length,
        webviewDetaches: closeWebview.mock.calls.length,
        zombiePushesForOneActionOneCoreEventOneAppearance: channels.reduce((sum, channel) => sum + channel.port1.posted.length, 0) - beforePush })
    }
  }
  const result = { benchmark: 'PluginFrame native load lifecycle', solidIdentity: createComponent === webCreateComponent, constructions, cleanups, loadCallbackHasSolidOwner: loadOwner !== null,
    checkpoints, cleanupWarnings: warnings.filter((args) => String(args[0]).includes('cleanups')).length }
  writeFileSync(resolve(dirname(fileURLToPath(import.meta.url)), `evidence/client-frame-lifetime-${evidenceTag}.json`), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' })

  warn.mockRestore()
  vi.unstubAllGlobals()
})

it('measures identical loaded contribution passes through the actual registry and Solid list consumer', () => {
  _resetFrameContributions()
  _resetChromeContributions()
  _resetPluginDistribution()
  const count = 20
  const rows = Array.from({ length: count }, (_, i) => ({
    name: `audit${i}`, required: false, disabled: false, running: true, state: 'active',
    installed: { version: '1.0.0', apiVersion: PLUGIN_API_MAJOR,
      permissions: { api: [], events: [], node: { core: [], capabilities: [], secrets: false, exec: false, net: [], sockets: false } },
      client: { hash: String(i).padStart(64, 'a'), bytes: 12 },
      contributions: { frames: [{ id: 'pane', label: `Audit${i}`, glyph: 'puzzle', target: 'pane', order: i,
        formFactor: ['desktop'], layout: 'single', regions: { body: 'frame' } }] },
    },
  }))
  _seedPluginDistribution([['synthetic', rows]] as any, rows.map((row) => `${row.name} ${row.installed.client.hash}`))
  syncPluginContributions()
  let reads = 0, mounts = 0, unmounts = 0
  const history: number[] = []
  const stopRead = createRoot((dispose) => {
    createRenderEffect(() => { reads++; history.push(paneRegistry.entries().length) })
    return dispose
  })
  const host = document.createElement('div')
  const qc = new QueryClient()
  const stopDraw = render(() => <QueryClientProvider client={qc}><For each={paneRegistry.entries()}>{(pane) => {
    mounts++
    onCleanup(() => unmounts++)
    return pane.id
  }}</For></QueryClientProvider>, host)
  const checkpoints = []
  for (let i = 0; i < 10; i++) {
    const prev = { reads, mounts, unmounts }
    const cpu = process.cpuUsage()
    const at = performance.now()
    syncPluginContributions()
    checkpoints.push({ unchangedPass: i + 1, ms: performance.now() - at,
      cpuUs: process.cpuUsage(cpu), registryObserverRuns: reads - prev.reads, paneListMounts: mounts - prev.mounts, paneListUnmounts: unmounts - prev.unmounts })
  }
  const result = { benchmark: 'unchanged loaded contribution reconciliation', plugins: count, checkpoints,
    registryObserverSawEmptyRoster: history.includes(0) }
  writeFileSync(resolve(dirname(fileURLToPath(import.meta.url)), `evidence/client-registration-${evidenceTag}.json`), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' })

  stopDraw(); stopRead(); qc.clear()
  _resetFrameContributions(); _resetChromeContributions(); _resetPluginDistribution()
})
