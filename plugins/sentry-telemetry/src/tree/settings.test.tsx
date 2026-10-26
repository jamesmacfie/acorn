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
    else if (op.op === 'text') {
      const node = nodes.get(op.id)
      if (node) node.props.value = op.value
    } else if (op.op === 'remove') nodes.delete(op.id)
  }
  return nodes
}

function mount(
  stored: unknown,
  environment: string | null = null,
  team: { shareable: boolean; shared?: unknown } = { shareable: false },
) {
  const ops: TreeMutation[] = []
  const root = createRemoteRoot((batch) => ops.push(...batch))
  const set = vi.fn(async () => {})
  const get = vi.fn(async (path: string) => {
    if (path !== '/v1/p/sentry-telemetry/source') throw new Error(`no route ${path}`)
    return { environment, shareable: team.shareable }
  })
  const bridge = {
    state: { get: async (key: string) => (key === 'share' ? team.shared : stored), set },
    api: { get },
  } as unknown as AcornBridge
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
  const checkbox = (label: string) => checkboxes().find((node) => node.props.ariaLabel === label)
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
    expect(page.checkboxes().map((node) => node.props.ariaLabel)).toEqual([
      'Errors',
      'Traces',
      'Logs',
      'Metrics',
      'Events',
      'Stack traces on errors',
      'Task ids as tags',
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

  it('puts a switch back and names the failure on its row when the write fails', async () => {
    const page = mount(null)
    await settle()
    page.set.mockRejectedValueOnce(new Error('The node refused the settings'))
    page.press('Logs', false)
    await settle()
    expect(page.checkbox('Logs')?.props.checked).toBe(true)
    const rows = [...applied(page.ops).values()].filter((node) => node.type === 'SettingRow')
    expect(rows.find((node) => node.props.label === 'Logs')?.props.error).toBe('The node refused the settings')
    expect(rows.filter((node) => node.props.error)).toHaveLength(1)
    page.root.dispose()
  })

  it('says that both the core switch and a connection are needed', async () => {
    const page = mount(null)
    await settle()
    const text = [...applied(page.ops).values()].map((node) => JSON.stringify(node.props)).join(' ')
    expect(text).toContain('turn on Telemetry')
    expect(text).toContain('connect Sentry in Services')
    page.root.dispose()
  })

  it('names the project and the variable when the DSN comes from the environment', async () => {
    const page = mount(null, 'o7.ingest.de.sentry.io/7654321')
    await settle()
    const sending = [...applied(page.ops).values()].find((node) => node.props.id === 'sending')
    expect(sending?.props.description).toBe('Sending to o7.ingest.de.sentry.io/7654321 from ACORN_SENTRY_DSN.')
    page.root.dispose()
  })

  it('offers Share with the acorn team, off, only when the node says the team DSN would be used', async () => {
    const page = mount(null, null, { shareable: true })
    await settle()
    expect(page.checkbox('Share with the acorn team')?.props.checked).toBe(false)
    const sharing = [...applied(page.ops).values()].find((node) => node.props.id === 'sharing')
    expect(sharing?.props.description).toContain('errors')
    expect(sharing?.props.description).toContain('Sentry')
    page.press('Share with the acorn team', true)
    await settle()
    expect(page.set).toHaveBeenCalledWith('share', true)
    expect(page.checkbox('Share with the acorn team')?.props.checked).toBe(true)
    const sending = [...applied(page.ops).values()].find((node) => node.props.id === 'sending')
    expect(sending?.props.description).toContain('fixed choices')
    page.root.dispose()
  })

  it('shows a stored share as on', async () => {
    const page = mount(null, null, { shareable: true, shared: true })
    await settle()
    expect(page.checkbox('Share with the acorn team')?.props.checked).toBe(true)
    page.root.dispose()
  })
})
