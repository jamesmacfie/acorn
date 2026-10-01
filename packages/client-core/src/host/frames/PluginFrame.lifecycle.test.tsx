import { createComponent } from 'solid-js'
import { render } from 'solid-js/web'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { afterEach, expect, it, vi } from 'vitest'
const observed = vi.hoisted(() => ({ bridges: [] as { onMisbehaving: (reason: string) => void }[] }))
vi.mock('@solidjs/router', () => ({ useNavigate: () => () => {} }))
vi.mock('./broker', async (original) => {
  const module = await original<typeof import('./broker')>()
  return { ...module, createFrameBridge: (options: Parameters<typeof module.createFrameBridge>[0]) => {
    observed.bridges.push(options as never)
    return module.createFrameBridge(options)
  } }
})
import PluginFrame from './PluginFrame'
import { clientEvents } from '../registries/commands/clientEvents'

class Port {
  onmessage: ((event: { data: unknown }) => void) | null = null
  posts: unknown[] = []
  closes = 0
  start() {}
  close() { this.closes++ }
  postMessage(data: unknown) { this.posts.push(data) }
}
const channels: { port1: Port; port2: Port }[] = []
class Channel {
  port1 = new Port(); port2 = new Port()
  constructor() { channels.push(this) }
}
const stops: (() => void)[] = []
afterEach(() => {
  stops.splice(0).forEach((stop) => stop())
  channels.length = 0; observed.bridges.length = 0
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers()
})
const mount = (subscribe: () => () => void) => {
  vi.stubGlobal('MessageChannel', Channel)
  const qc = new QueryClient()
  const host = document.createElement('div'); document.body.append(host)
  const stop = render(() => createComponent(QueryClientProvider, { client: qc, get children() { return <PluginFrame hash={'a'.repeat(64)} binding={{ pluginId: 'audit', surface: 'audit.pane', target: 'pane', nodeId: 'node-a', taskId: 'task', api: [], events: ['runtime:task-archived'], panes: [], claimsKeys: [] }} webview={{ navigate: async () => true, command: async () => true, subscribe }} /> } }), host)
  stops.push(() => { stop(); host.remove(); qc.clear() })
  return { host, stop }
}
it('drains all load resources when an external cleanup throws and prevents retired event pushes', () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const detach = vi.fn(() => { throw new Error('external unsubscribe failed') })
  const frame = mount(() => detach)
  const iframe = frame.host.querySelector('iframe')!
  iframe.contentWindow!.postMessage = () => {}
  iframe.dispatchEvent(new Event('load'))
  const channel = channels[0]
  channel.port1.onmessage!({ data: { id: 1, kind: 'subscribe', channel: 'runtime:task-archived' } })
  frame.stop()
  expect(detach).toHaveBeenCalledTimes(1)
  expect(channel.port1.closes).toBe(1)
  expect(channel.port2.closes).toBe(1)
  const posted = channel.port1.posts.length
  clientEvents.emit('runtime:task-archived', { taskId: 'task' })
  clientEvents.emit('plugin:surface-action', { pluginId: 'audit', surface: 'audit.pane', command: 'run' })
  expect(channel.port1.posts).toHaveLength(posted)
})
it('releases partially connected resources on setup failure and shows the original failure', () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const frame = mount(() => { throw new Error('original setup failure') })
  const iframe = frame.host.querySelector('iframe')!
  iframe.contentWindow!.postMessage = () => {}
  iframe.dispatchEvent(new Event('load'))
  expect(channels[0].port1.closes).toBe(1)
  expect(channels[0].port2.closes).toBe(1)
  expect(frame.host.textContent).toContain('original setup failure')
  expect(frame.host.querySelector('iframe')).toBeNull()
})
it('ignores a held old-load failure and deadline after a replacement load', () => {
  vi.useFakeTimers()
  const listeners: EventListener[] = []
  const real = HTMLIFrameElement.prototype.addEventListener
  vi.spyOn(HTMLIFrameElement.prototype, 'addEventListener').mockImplementation(function (this: HTMLIFrameElement, kind: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) {
    if (kind === 'load') listeners.push(listener as EventListener)
    real.call(this, kind, listener, options)
  })
  const frame = mount(() => () => {})
  const iframe = frame.host.querySelector('iframe')!
  iframe.contentWindow!.postMessage = () => {}
  listeners[0].call(iframe, new Event('load'))
  const old = observed.bridges[0]
  listeners[0].call(iframe, new Event('load'))
  channels[1].port1.onmessage!({ data: { kind: 'connected', version: 1 } })
  old.onMisbehaving('held old failure')
  vi.advanceTimersByTime(20_000)
  expect(channels[0].port1.closes).toBe(1)
  expect(channels[1].port1.closes).toBe(0)
  expect(frame.host.querySelector('iframe')).toBe(iframe)
})
