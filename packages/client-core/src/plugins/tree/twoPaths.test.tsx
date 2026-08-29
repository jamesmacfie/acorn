import { createComponent, type JSX } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TreeMutation } from '@acorn/protocol/tree/messages.ts'
import { createNode, createRemoteRoot, createText, insertNode, setProperty, type RemoteNode } from '../frames/remoteRoot'
import { KIT_COMPONENTS } from './components'
import { TreeHost, type TreeTransport } from './TreeHost'

// One description of a card, drawn twice: compiled straight into the shell, and through the remote
// root, a worker's worth of serialization, and TreeHost. The DOM has to come out the same, because
// "one component API, two render paths" is either true at the pixel or it is marketing.
//
// The description is a function over a sink rather than JSX, and that is the honest limit of this
// test: a `.tsx` file compiles under one JSX preset per vitest project, and the remote path's preset
// is `generate: 'universal'`. Compiling the same component both ways needs a second build pipeline,
// so what is pinned here is everything downstream of the preset — the node names, the props, the
// handlers, the serialization, the batch, and the host's mount. Whether Solid's universal preset
// reaches these same calls is `acorn-plugin-sdk/remote`'s job, and the running app's.

type Sink<N> = {
  node(type: string, props: Record<string, unknown>, children: N[]): N
  text(value: string): N
}

// The shape of changes' agent tool card, which is the card this phase exists to prove.
const toolCard = <N,>(sink: Sink<N>, press: () => void): N =>
  sink.node('Fold', { label: 'Edit src/app.ts', open: true, onOpenChange: () => {} }, [
    sink.node('Stack', { gap: 'row' }, [
      sink.node('Badge', { tone: 'ok', size: 'xs' }, [sink.text('completed')]),
      sink.node('CodeBlock', { maxHeight: 'block' }, [sink.text('- old\n+ new')]),
      sink.node('Button', { variant: 'bare', onPress: press }, [sink.text('src/app.ts')]),
    ]),
  ])

const directSink: Sink<JSX.Element> = {
  node: (type, props, children) =>
    createComponent(KIT_COMPONENTS[type as keyof typeof KIT_COMPONENTS], { ...props, get children() { return children } }),
  text: (value) => value,
}

const remoteSink: Sink<RemoteNode> = {
  node: (type, props, children) => {
    const node = createNode(type)
    for (const [name, value] of Object.entries(props)) setProperty(node, name, value)
    for (const child of children) insertNode(node, child, null)
    return node
  },
  text: (value) => createText(value),
}

let direct: HTMLElement
let remote: HTMLElement
const disposers: (() => void)[] = []

beforeEach(() => {
  direct = document.createElement('div')
  remote = document.createElement('div')
  document.body.append(direct, remote)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose()
  direct.remove()
  remote.remove()
  vi.restoreAllMocks()
})

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

describe('the compiled card and the remote card are the same card', () => {
  it('draws the same DOM through both paths, and the button works through both', async () => {
    const directPress = vi.fn()
    disposers.push(render(() => toolCard(directSink, directPress), direct))

    const batches: TreeMutation[][] = []
    const root = createRemoteRoot((ops) => batches.push(ops))
    insertNode(root.node, toolCard(remoteSink, () => {}), null)
    await new Promise<void>((resolve) => queueMicrotask(resolve))
    expect(batches).toHaveLength(1)

    let deliver: ((ops: readonly TreeMutation[]) => void) | null = null
    const transport: TreeTransport = {
      onBatch: (listener) => { deliver = listener; return () => {} },
      onFailed: () => () => {},
      // Back to the sandbox's own closure, which is the half a worker would carry.
      send: (handler, _event, payload) => root.dispatch(handler, payload),
    }
    disposers.push(render(() => <TreeHost pluginId="changes" transport={transport} />, remote))
    for (const ops of batches) deliver!(ops)
    await frame()

    expect(remote.innerHTML).toBe(direct.innerHTML)

    direct.querySelector('button')!.click()
    expect(directPress).toHaveBeenCalledTimes(1)
  })

  it('carries a press back across the port', async () => {
    const pressed = vi.fn()
    const batches: TreeMutation[][] = []
    const root = createRemoteRoot((ops) => batches.push(ops))
    insertNode(root.node, toolCard(remoteSink, pressed), null)
    await new Promise<void>((resolve) => queueMicrotask(resolve))

    let deliver: ((ops: readonly TreeMutation[]) => void) | null = null
    const transport: TreeTransport = {
      onBatch: (listener) => { deliver = listener; return () => {} },
      onFailed: () => () => {},
      send: (handler, _event, payload) => root.dispatch(handler, payload),
    }
    disposers.push(render(() => <TreeHost pluginId="changes" transport={transport} />, remote))
    for (const ops of batches) deliver!(ops)
    await frame()

    remote.querySelector('button')!.click()
    expect(pressed).toHaveBeenCalledTimes(1)
  })
})
