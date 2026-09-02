import { createComponent, type JSX } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { KIT_NODES } from '@acorn/protocol/tree/nodes.ts'
import type { TreeMutation } from '@acorn/protocol/tree/messages.ts'
import { createRemoteRoot, insertNode, type RemoteNode } from './remoteRoot'
import { KIT_NODE_COMPONENTS } from './remoteSolid'
import { KIT_COMPONENTS } from '../tree/components'
import { kitComponent } from '../tree/kitEntry'
import { TreeHost, type TreeTransport } from '../tree/TreeHost'

// The kit, written by a plugin and drawn by the host: `remoteSolid.ts`'s node components against
// `components.ts`'s real ones, through a serialization in between.
//
// ./twoPaths.test.tsx pinned the same claim one rung lower, over hand-built nodes. This one starts
// where a plugin starts — `<Card tone="ok">` — which is the rung the loaded four moved onto in phase 5.
//
// Called rather than written as JSX, and that is the honest limit here: a `.tsx` file compiles under
// one preset per vitest project, and this project's is the DOM one. What Solid's universal preset
// emits is `createComponent(Card, props)`, which is exactly the call below, so everything downstream of
// the preset is pinned and the preset itself is the running app's business.

/** A kit node the way the preset reaches it: a component call with a props object. */
const node = (type: string, props: Record<string, unknown>): RemoteNode =>
  (KIT_NODE_COMPONENTS[type as keyof typeof KIT_NODE_COMPONENTS] as unknown as (p: Record<string, unknown>) => RemoteNode)(props)

// Through `kitComponent`, because a table entry is a component or a loader for one and the host
// resolves it in one place (../tree/kitEntry.ts). Every node below is a cheap primitive, so what
// comes back is always the component itself.
const direct = (type: string, props: Record<string, unknown>): JSX.Element =>
  createComponent(kitComponent(KIT_COMPONENTS[type as keyof typeof KIT_COMPONENTS])!, props)

let host: HTMLElement
let shell: HTMLElement
const disposers: (() => void)[] = []

beforeEach(() => {
  host = document.createElement('div')
  shell = document.createElement('div')
  document.body.append(host, shell)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose()
  host.remove()
  shell.remove()
  vi.restoreAllMocks()
})

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

/** Mount a remote tree's batches into a TreeHost and wait for the coalescing frame. */
async function draw(build: () => RemoteNode, into: HTMLElement, send?: (handler: number, payload: unknown) => void) {
  const batches: TreeMutation[][] = []
  const root = createRemoteRoot((ops) => batches.push(ops))
  insertNode(root.node, build(), null)
  await new Promise<void>((resolve) => queueMicrotask(resolve))
  let deliver: ((ops: readonly TreeMutation[]) => void) | null = null
  const transport: TreeTransport = {
    onBatch: (listener) => { deliver = listener; return () => {} },
    onFailed: () => () => {},
    send: (handler, _event, payload) => (send ? send(handler, payload) : root.dispatch(handler, payload)),
  }
  disposers.push(render(() => <TreeHost pluginId="rollbar" transport={transport} />, into))
  for (const ops of batches) deliver!(ops)
  await frame()
}

describe('the kit as a plugin writes it', () => {
  it('has a node component for every name in the kit, and nothing else', () => {
    expect(Object.keys(KIT_NODE_COMPONENTS).sort()).toEqual([...KIT_NODES].sort())
    for (const name of KIT_NODES) expect(typeof KIT_NODE_COMPONENTS[name]).toBe('function')
  })

  it('draws the same DOM through the node components as through the components themselves', async () => {
    // A slice of the rollbar pane: a heading with an eyebrow, a status badge, and a fact list, which
    // between them cover a string child, a role prop, and an array-of-objects prop.
    const build = () => node('Stack', {
      gap: 'section',
      children: [
        node('Heading', { level: 1, eyebrow: 'Sentry · #14', children: 'Undefined is not a function' }),
        node('Badge', { tone: 'danger', size: 'xs', children: 'critical' }),
        node('Facts', { items: [{ label: 'Occurrences', value: '412', mono: true }] }),
      ],
    })
    await draw(build, host)

    disposers.push(render(() => direct('Stack', {
      gap: 'section',
      children: [
        direct('Heading', { level: 1, eyebrow: 'Sentry · #14', children: 'Undefined is not a function' }),
        direct('Badge', { tone: 'danger', size: 'xs', children: 'critical' }),
        direct('Facts', { items: [{ label: 'Occurrences', value: '412', mono: true }] }),
      ],
    }), shell))

    expect(host.innerHTML).toBe(shell.innerHTML)
  })

  it('carries a press back to the plugin through a node component', async () => {
    const pressed = vi.fn()
    await draw(() => node('Button', { variant: 'bare', onPress: pressed, children: 'Refresh' }), host)
    host.querySelector('button')!.click()
    expect(pressed).toHaveBeenCalledTimes(1)
  })

  it('refuses a class a plugin tried to set, and still draws the node', async () => {
    const refused: string[] = []
    const batches: TreeMutation[][] = []
    const root = createRemoteRoot((ops) => batches.push(ops))
    insertNode(root.node, node('Badge', { tone: 'ok', class: 'sneaky', children: 'ok' }), null)
    await new Promise<void>((resolve) => queueMicrotask(resolve))
    let deliver: ((ops: readonly TreeMutation[]) => void) | null = null
    const transport: TreeTransport = {
      onBatch: (listener) => { deliver = listener; return () => {} },
      onFailed: () => () => {},
      send: () => {},
    }
    disposers.push(render(
      () => <TreeHost pluginId="rollbar" transport={transport} onRefused={(reason) => refused.push(reason)} />,
      host,
    ))
    for (const ops of batches) deliver!(ops)
    await frame()

    expect(host.querySelector('.ui-badge')).not.toBeNull()
    expect(host.innerHTML).not.toContain('sneaky')
    expect(refused.join(' ')).toContain('class')
  })
})
