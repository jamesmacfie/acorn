import { MessageChannel } from 'node:worker_threads'
import { runInNewContext } from 'node:vm'
import { expect, it, vi } from 'vitest'
import { sandboxMessage } from '@acorn/protocol/tree/messages.ts'
// @ts-expect-error: the published zero-dependency scaffold has no declarations.
import { scaffoldFiles } from './index.mjs'

type Message = Record<string, unknown>
type Element = {
  children: Element[]
  textContent: string
  className: string
  dataset: Record<string, string>
  style: { padding?: string; setProperty(name: string, value: string): void; values: Record<string, string> }
  listeners: Map<string, () => void>
  append(...children: Element[]): void
  addEventListener(name: string, listener: () => void): void
}

function element(): Element {
  const values: Record<string, string> = {}
  return {
    children: [], textContent: '', className: '', dataset: {},
    style: { values, setProperty: (name, value) => { values[name] = value } },
    listeners: new Map(),
    append(...children) { this.children.push(...children) },
    addEventListener(name, listener) { this.listeners.set(name, listener) },
  }
}

it('connects the generated tree, draws its own pane, and handles a button press', async () => {
  const files = scaffoldFiles('my-widget', 'My widget') as Record<string, string>
  let hello: ((event: { data: Message; ports: unknown[] }) => void) | undefined
  runInNewContext(files['client.js']!, {
    addEventListener: (_kind: string, listener: typeof hello) => { hello = listener },
  })
  const bridge = new MessageChannel()
  const tree = new MessageChannel()
  const scoped = new MessageChannel()
  const bridgeMessages: Message[] = []
  const treeMessages: Message[] = []
  const scopedMessages: Message[] = []
  bridge.port1.on('message', (message: Message) => bridgeMessages.push(message))
  tree.port1.on('message', (message: Message) => treeMessages.push(message))
  scoped.port1.on('message', (message: Message) => scopedMessages.push(message))
  try {
    hello!({ data: { acornBridge: 1 }, ports: [bridge.port2, tree.port2] })
    bridge.port1.postMessage({ kind: 'ready', context: {} })
    await vi.waitFor(() => expect(bridgeMessages).toContainEqual({ kind: 'connected' }))
    await vi.waitFor(() => expect(treeMessages).toContainEqual({ kind: 'tree:ready', version: 1, entries: ['pane'], scopedBridge: true }))
    expect(sandboxMessage.safeParse(treeMessages[0]).success).toBe(true)

    tree.port1.postMessage({
      kind: 'tree:mount', slot: 'pane-1', entry: 'pane', props: {},
      context: { taskId: 'task 1' }, bridgePort: scoped.port2,
    }, [scoped.port2])
    scoped.port1.postMessage({ kind: 'ready', context: { surface: 'my-widget', target: 'pane' } })
    await vi.waitFor(() => expect(scopedMessages).toContainEqual({ kind: 'connected' }))
    await vi.waitFor(() => expect(treeMessages.some((message) => message.kind === 'tree:batch')).toBe(true))
    const batch = treeMessages.find((message) => message.kind === 'tree:batch')!
    expect(sandboxMessage.safeParse(batch).success).toBe(true)
    expect(batch.slot).toBe('pane-1')
    const ops = batch.ops as { op: string; node: TreeNode }[]
    const nodes = flatten(ops[0]!.node)
    expect(nodes.find((node) => node.type === 'Heading')?.children[0]?.props.value).toBe('My widget')
    const button = nodes.find((node) => node.type === 'Button')!
    const greeting = nodes.find((node) => node.props.value === 'Ask the Node for a greeting')!
    const handler = (button.props.onPress as { $handler: number }).$handler

    tree.port1.postMessage({ kind: 'tree:event', slot: 'pane-1', handler, event: 'onPress', payload: null })
    await vi.waitFor(() => expect(scopedMessages).toContainEqual({
      kind: 'api', method: 'GET', path: '/v1/p/my-widget/greeting?taskId=task%201', id: 1,
    }))
    expect(bridgeMessages).toEqual([{ kind: 'connected' }])
    scoped.port1.postMessage({ id: 1, ok: true, body: { text: 'Hello from the node' } })
    await vi.waitFor(() => expect(treeMessages).toContainEqual({
      kind: 'tree:batch', slot: 'pane-1', ops: [{ op: 'text', id: greeting.id, value: 'Hello from the node' }],
    }))
    expect(sandboxMessage.safeParse(treeMessages.at(-1)).success).toBe(true)
    tree.port1.postMessage({ kind: 'tree:ping' })
    await vi.waitFor(() => expect(treeMessages).toContainEqual({ kind: 'tree:pong' }))
    tree.port1.postMessage({ kind: 'tree:mount', slot: 'pane-1', entry: 'pane', props: { taskId: 'task-2' } })
    await vi.waitFor(() => expect(treeMessages.filter((message) => message.kind === 'tree:batch')).toHaveLength(3))
    const replacement = treeMessages.filter((message) => message.kind === 'tree:batch').at(-1)!
    expect(sandboxMessage.safeParse(replacement).success).toBe(true)
    expect((replacement.ops as { op: string; id?: string }[])[0]).toEqual({ op: 'remove', id: ops[0]!.node.id })
  } finally {
    bridge.port1.close(); bridge.port2.close(); tree.port1.close(); tree.port2.close(); scoped.port1.close()
  }
})

type TreeNode = { id: string; type: string; props: Record<string, unknown>; children: TreeNode[] }

function flatten(node: TreeNode): TreeNode[] {
  return [node, ...node.children.flatMap(flatten)]
}

it('closes replaced slot bridges and drops replies after remount or unmount', async () => {
  const files = scaffoldFiles('my-widget') as Record<string, string>
  let hello: ((event: { data: Message; ports: unknown[] }) => void) | undefined
  runInNewContext(files['client.js']!, {
    addEventListener: (_kind: string, listener: typeof hello) => { hello = listener },
  })
  const bootstrap = new MessageChannel()
  const tree = new MessageChannel()
  const first = new MessageChannel()
  const second = new MessageChannel()
  const batches: Message[] = []
  const firstRequests: Message[] = []
  const secondRequests: Message[] = []
  let firstClosed = false
  let secondClosed = false
  tree.port1.on('message', (message: Message) => { if (message.kind === 'tree:batch') batches.push(message) })
  first.port1.on('message', (message: Message) => firstRequests.push(message))
  second.port1.on('message', (message: Message) => secondRequests.push(message))
  first.port1.on('close', () => { firstClosed = true })
  second.port1.on('close', () => { secondClosed = true })
  try {
    hello!({ data: { acornBridge: 1 }, ports: [bootstrap.port2, tree.port2] })
    tree.port1.postMessage({ kind: 'tree:mount', slot: 'pane-1', entry: 'pane', props: {}, bridgePort: first.port2 }, [first.port2])
    await vi.waitFor(() => expect(batches).toHaveLength(1))
    const button = flatten((batches[0]!.ops as { node: TreeNode }[])[0]!.node).find((node) => node.type === 'Button')!
    const handler = (button.props.onPress as { $handler: number }).$handler
    tree.port1.postMessage({ kind: 'tree:event', slot: 'pane-1', handler, event: 'onPress', payload: null })
    await vi.waitFor(() => expect(firstRequests.some((message) => message.kind === 'api')).toBe(true))

    tree.port1.postMessage({ kind: 'tree:mount', slot: 'pane-1', entry: 'pane', props: {}, bridgePort: second.port2 }, [second.port2])
    await vi.waitFor(() => expect(firstClosed).toBe(true))
    await vi.waitFor(() => expect(batches).toHaveLength(2))
    first.port1.postMessage({ id: 1, ok: true, body: { text: 'stale reply' } })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(batches).toHaveLength(2)

    const nextButton = flatten((batches[1]!.ops as { node?: TreeNode }[])[1]!.node!).find((node) => node.type === 'Button')!
    tree.port1.postMessage({
      kind: 'tree:event', slot: 'pane-1', handler: (nextButton.props.onPress as { $handler: number }).$handler,
      event: 'onPress', payload: null,
    })
    await vi.waitFor(() => expect(secondRequests.some((message) => message.kind === 'api')).toBe(true))
    tree.port1.postMessage({ kind: 'tree:unmount', slot: 'pane-1' })
    await vi.waitFor(() => expect(secondClosed).toBe(true))
    second.port1.postMessage({ id: 1, ok: true, body: { text: 'too late' } })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(batches).toHaveLength(2)
  } finally {
    bootstrap.port1.close(); bootstrap.port2.close(); tree.port1.close(); tree.port2.close()
    first.port1.close(); second.port1.close()
  }
})

it('connects the generated frame, fetches its own greeting, and sends a toast', async () => {
  const files = scaffoldFiles('my-widget', 'My widget', { rectangle: true }) as Record<string, string>
  const body = element()
  const documentElement = element()
  let hello: ((event: { data: Message; ports: unknown[] }) => void) | undefined
  runInNewContext(files['client.js']!, {
    document: { body, documentElement, createElement: () => element() },
    addEventListener: (_kind: string, listener: typeof hello) => { hello = listener },
  })
  const bridge = new MessageChannel()
  const messages: Message[] = []
  bridge.port1.on('message', (message: Message) => messages.push(message))
  try {
    hello!({ data: { acornBridge: 1 }, ports: [bridge.port2] })
    bridge.port1.postMessage({ kind: 'ready', context: { taskId: 'task 1' } })
    await vi.waitFor(() => expect(messages).toContainEqual({ kind: 'connected' }))
    await vi.waitFor(() => expect(messages.some((message) => message.kind === 'api')).toBe(true))
    const request = messages.find((message) => message.kind === 'api')!
    expect(request).toMatchObject({ method: 'GET', path: '/v1/p/my-widget/greeting?taskId=task%201' })
    bridge.port1.postMessage({ id: request.id, ok: true, body: { text: 'Hello from task 1' } })
    await vi.waitFor(() => expect(body.children[0]?.children[0]?.textContent).toBe('Hello from task 1'))

    const button = body.children[0]!.children[1]!
    expect(button.textContent).toBe('Say hello back')
    button.listeners.get('click')!()
    await vi.waitFor(() => expect(messages).toContainEqual({
      kind: 'ui', op: 'toast', title: 'My widget', detail: 'Hello from the frame', id: 2,
    }))
    bridge.port1.postMessage({ kind: 'appearance', theme: 'dark', style: 'terminal', tokens: { '--bg': '#111' } })
    await vi.waitFor(() => expect(documentElement.dataset.theme).toBe('dark'))
    expect(documentElement.style.values['--bg']).toBe('#111')
  } finally {
    bridge.port1.close(); bridge.port2.close()
  }
})
