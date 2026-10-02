import { describe, expect, it } from 'vitest'
import type { TreeNode } from '@acorn/protocol/tree/messages.ts'
import { createRemoteRoot } from '@acorn/plugin-api/testkit/client'
import type { AcornBridge } from '@acorn/plugin-api/ui/sdk'
import { solidTree } from '@acorn/plugin-api/ui/tree'
import { LinearIssuePane } from './app'

// The pane, driven through `solidTree` into a remote root, the way rollbar's app test drives its own.
// What this pins is switching issues: the detail must never show one issue while the host has picked
// another, because a comment typed in that gap went to the issue on screen.

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

const issue = (identifier: string) => ({
  id: `id-${identifier}`, identifier, title: `Title of ${identifier}`, url: '', state: null, assignee: null,
  description: null, comments: [], activity: [],
})

function mount(get: (path: string) => Promise<unknown>, post: (path: string) => Promise<unknown> = () => Promise.resolve({})) {
  let select: (item: string) => void = () => {}
  const root = createRemoteRoot(() => {})
  const bridge = {
    api: { get, post },
    ui: { copy: () => Promise.resolve(), toast: () => Promise.resolve(), openUrl: () => Promise.resolve() },
    onSelect: (handler: (item: string) => void) => {
      select = handler
      return () => {}
    },
  } as unknown as AcornBridge
  solidTree(LinearIssuePane)(bridge, {
    entry: 'pane',
    root,
    props: () => ({ item: 'conn:ACO-1' }),
    onProps: () => {},
    onUnmount: () => {},
    host: {
      invoke: () => Promise.reject(new Error('this fixture answers no host requests')),
      openOverlay: () => Promise.reject(new Error('this fixture answers no host requests')),
    },
  })
  const nodes = () => {
    const found: TreeNode[] = []
    const visit = (node: TreeNode) => {
      found.push(node)
      node.children.forEach(visit)
    }
    root.node.children.forEach(visit)
    return found
  }
  const text = (node: TreeNode): string =>
    node.type === '#text' ? String(node.props.value ?? '') : node.children.map(text).join('')
  const heading = () => {
    const found = nodes().find((node) => node.type === 'Heading')
    return found ? text(found) : undefined
  }
  return { root, nodes, heading, select: (item: string) => select(item) }
}

describe('LinearIssuePane', () => {
  it('clears the issue on screen while the next one loads', async () => {
    let release: (value: unknown) => void = () => {}
    const pane = mount((path) => path.includes('ACO-2')
      ? new Promise((resolve) => { release = resolve })
      : Promise.resolve(issue('ACO-1')))
    await settle()
    expect(pane.heading()).toBe('Title of ACO-1')

    pane.select('conn:ACO-2')
    await settle()
    expect(pane.heading()).toBeUndefined()
    expect(pane.nodes().some((node) => node.type === 'Composer')).toBe(false)

    release(issue('ACO-2'))
    await settle()
    expect(pane.heading()).toBe('Title of ACO-2')
    pane.root.dispose()
  })

  it('does not pull the old issue back when a comment lands after a switch', async () => {
    let posted: (value: unknown) => void = () => {}
    const pane = mount(
      (path) => Promise.resolve(issue(path.includes('ACO-2') ? 'ACO-2' : 'ACO-1')),
      () => new Promise((resolve) => { posted = resolve }),
    )
    await settle()
    const composer = pane.nodes().find((node) => node.type === 'Composer')
    ;(composer?.props.onSubmit as (body: string) => void)('hello')
    pane.select('conn:ACO-2')
    await settle()
    expect(pane.heading()).toBe('Title of ACO-2')

    posted({})
    await settle()
    await settle()
    expect(pane.heading()).toBe('Title of ACO-2')
    pane.root.dispose()
  })
})
