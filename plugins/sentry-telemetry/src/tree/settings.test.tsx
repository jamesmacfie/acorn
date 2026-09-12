import type { TreeMutation, TreeNode } from '@acorn/protocol/tree/messages.ts'
import { createRemoteRoot } from '@acorn/plugin-api/testkit/client'
import type { AcornBridge } from '@acorn/plugin-api/ui/sdk'
import { solidTree } from '@acorn/plugin-api/ui/tree'
import { describe, expect, it, vi } from 'vitest'
import SentrySettingsPage from './settings'
import { DEFAULT_SETTINGS } from '../shared/settings'

// The page, driven the way the sandbox drives it: through `solidTree` into a remote root, with the
// mutations it emits as the only evidence. No worker and no host on the other side.
//
// The mutations are applied rather than scanned, because a reactive change arrives as a `patch` on
// a node that was inserted earlier. Reading the inserts alone would only ever see the first paint,
// which for this page is the moment before the stored settings have loaded.

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

function applied(ops: TreeMutation[]): Map<string, TreeNode> {
  const nodes = new Map<string, TreeNode>()
  const index = (node: TreeNode): void => {
    nodes.set(node.id, node)
    node.children.forEach(index)
  }
  for (const op of ops) {
    if (op.op === 'insert') index(op.node)
    else if (op.op === 'patch') Object.assign(nodes.get(op.id)?.props ?? {}, op.props)
    else if (op.op === 'text') { const node = nodes.get(op.id); if (node) node.props.value = op.value }
    else if (op.op === 'remove') nodes.delete(op.id)
  }
  return nodes
}

function mount(stored: unknown) {
  const ops: TreeMutation[] = []
  const root = createRemoteRoot((batch) => ops.push(...batch))
  const set = vi.fn(async () => {})
  const bridge = { state: { get: async () => stored, set } } as unknown as AcornBridge
  solidTree(SentrySettingsPage)(bridge, {
    entry: 'settings',
    root,
    props: () => ({}),
    onProps: () => {},
    onUnmount: () => {},
    host: {
      invoke: () => Promise.reject(new Error('this fixture answers no host requests')),
      openOverlay: () => Promise.reject(new Error('this fixture answers no host requests')),
    },
  })
  const checkboxes = () => [...applied(ops).values()].filter((node) => node.type === 'Checkbox')
  const checkbox = (label: string) => checkboxes().find((node) => node.props.label === label)
  // A function prop crosses as a handler id, never as a function, so a click is a dispatch.
  const press = (label: string, value: unknown) => {
    const handler = checkbox(label)?.props.onChange as { $handler: number } | undefined
    if (!handler) throw new Error(`no checkbox labelled ${label}`)
    root.dispatch(handler.$handler, value)
  }
  return { ops, root, set, checkboxes, checkbox, press }
}

describe('the Sentry export settings page', () => {
  it('draws a switch for each of the five kinds and the two detail choices', async () => {
    const page = mount(null)
    await settle()
    expect(page.checkboxes().map((node) => node.props.label)).toEqual([
      'Errors', 'Traces', 'Logs', 'Metrics', 'Events', 'Stack traces on errors', 'Task ids as tags',
    ])
    page.root.dispose()
  })

  it('starts from the defaults when nothing has been stored', async () => {
    const page = mount(null)
    await settle()
    expect(page.checkboxes().every((node) => node.props.checked === true)).toBe(true)
    page.root.dispose()
  })

  it('shows what was stored, filling in the fields an older build never wrote', async () => {
    const page = mount({ kinds: { metric: false } })
    await settle()
    expect(page.checkbox('Metrics')?.props.checked).toBe(false)
    expect(page.checkbox('Logs')?.props.checked).toBe(true)
    page.root.dispose()
  })

  it('writes the whole object back on a change, so there is no half-saved state', async () => {
    const page = mount(null)
    await settle()
    page.press('Stack traces on errors', false)
    await settle()
    expect(page.set).toHaveBeenCalledWith('settings', { ...DEFAULT_SETTINGS, stacks: false })
    expect(page.checkbox('Stack traces on errors')?.props.checked).toBe(false)
    page.root.dispose()
  })

  it('says that both the core switch and a connection are needed', async () => {
    const page = mount(null)
    await settle()
    const text = [...applied(page.ops).values()].map((node) => JSON.stringify(node.props)).join(' ')
    expect(text).toContain('Settings → Telemetry')
    expect(text).toContain('Settings → Integrations')
    page.root.dispose()
  })
})
