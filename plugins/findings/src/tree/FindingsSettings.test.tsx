import { describe, expect, it, vi } from 'vitest'
import { sandboxMessage, type TreeMutation, type TreeNode } from '@acorn/protocol/tree/messages.ts'
import { createRemoteRoot } from '@acorn/plugin-api/testkit/client'
import type { AcornBridge } from '@acorn/plugin-api/ui/sdk'
import { solidTree } from '@acorn/plugin-api/ui/tree'
import { findingsSettingsRoute } from '../contract/lifecycle'
import { findingsReviewTargetsRoute } from '../contract/review'
import { FindingsSettings } from './FindingsSettings'

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
const modelsRoute = '/v1/p/findings/models'

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

function mount(codexCatalogAvailable: () => boolean = () => true) {
  const ops: TreeMutation[] = []
  const batches: TreeMutation[][] = []
  const root = createRemoteRoot((batch) => {
    batches.push(batch)
    ops.push(...batch)
  })
  const put = vi.fn(async (_path: string, body: unknown) => body)
  const get = vi.fn(async (path: string) => {
    if (path === findingsSettingsRoute) {
      return { automaticPreparation: true, notifyWhenReady: false, backendId: null, modelId: null, targetId: null }
    }
    if (path === findingsReviewTargetsRoute) return [{ id: 'memory:change', label: 'Memory changes' }]
    if (path !== modelsRoute) throw new Error(`Unexpected GET ${path}`)
    return {
      backends: [{
        id: 'harness:claude-code',
        kind: 'harness',
        label: 'Claude Code',
        glyph: 'brand:agents/claude',
        models: [{ id: 'sonnet', label: 'Sonnet' }],
        defaultModelId: '',
      }, {
        id: 'harness:codex', kind: 'harness', label: 'Codex',
        models: codexCatalogAvailable() ? [{ id: 'gpt-one', label: 'GPT One' }] : [],
        defaultModelId: '',
        ...(codexCatalogAvailable() ? {} : { catalogUnavailable: true }),
      }],
      missing: [],
    }
  })
  const bridge = {
    api: {
      get,
      put,
    },
  } as unknown as AcornBridge
  solidTree(FindingsSettings)(bridge, {
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
  const nodes = () => [...applied(ops).values()]
  const checkbox = () => nodes().find((node) => node.type === 'Checkbox' && node.props.label === 'Prepare suggestions when I archive a task')
  return { root, get, put, nodes, checkbox, batches }
}

describe('FindingsSettings', () => {
  it('draws the archive review control after loading the model roster', async () => {
    const page = mount()
    await settle()
    await settle()

    expect(page.checkbox()?.props.checked).toBe(false)
    for (const batch of page.batches) {
      expect(() => structuredClone(batch)).not.toThrow()
      expect(sandboxMessage.safeParse({ kind: 'tree:batch', slot: 'findings-settings-test', ops: batch }).success).toBe(true)
    }
    page.root.dispose()
  })

  it('selects the available backend when archive review is enabled', async () => {
    const page = mount()
    await settle()
    await settle()
    const handler = page.checkbox()?.props.onChange as { $handler: number } | undefined
    expect(handler).toBeDefined()

    page.root.dispatch(handler!.$handler, true)
    await settle()

    expect(page.put).toHaveBeenCalledWith(findingsSettingsRoute, {
      automaticPreparation: true,
      notifyWhenReady: false,
      backendId: 'harness:claude-code',
      modelId: null,
      targetId: 'memory:change',
    })
    expect(page.nodes().some((node) => node.type === 'ModelBackendPicker')).toBe(true)
    expect(page.nodes().find((node) => node.type === 'Select' && node.props.label === 'Review target')?.props.options)
      .toEqual([{ value: 'memory:change', label: 'Memory changes' }])
    page.root.dispose()
  })

  it('saves a selected CLI and model from the shared picker', async () => {
    const page = mount()
    await settle()
    await settle()
    const checkbox = page.checkbox()?.props.onChange as { $handler: number }
    page.root.dispatch(checkbox.$handler, true)
    await settle()

    const picker = page.nodes().find((node) => node.type === 'ModelBackendPicker')
    const handler = picker?.props.onChange as { $handler: number } | undefined
    expect(handler).toBeDefined()
    page.root.dispatch(handler!.$handler, { backendId: 'harness:codex', modelId: 'gpt-one' })
    await settle()

    expect(page.put).toHaveBeenLastCalledWith(findingsSettingsRoute, {
      automaticPreparation: true,
      notifyWhenReady: false,
      backendId: 'harness:codex',
      modelId: 'gpt-one',
      targetId: 'memory:change',
    })
    expect(page.nodes().find((node) => node.type === 'ModelBackendPicker')?.props)
      .toMatchObject({ backendId: 'harness:codex', modelId: 'gpt-one' })
    page.root.dispose()
  })

  it('retries a failed Codex catalog read without resetting the selected backend', async () => {
    let codexAvailable = false
    const page = mount(() => codexAvailable)
    await settle()
    await settle()
    page.root.dispatch((page.checkbox()?.props.onChange as { $handler: number }).$handler, true)
    await settle()
    page.root.dispatch((page.nodes().find((node) => node.type === 'ModelBackendPicker')?.props.onChange as { $handler: number }).$handler,
      { backendId: 'harness:codex', modelId: '' })
    await settle()

    const retry = page.nodes().find((node) => node.type === 'Button' && node.props.label === 'Retry model list')
    expect(retry).toBeDefined()
    codexAvailable = true
    page.root.dispatch((retry?.props.onPress as { $handler: number }).$handler, undefined)
    await settle()
    await settle()

    const picker = page.nodes().find((node) => node.type === 'ModelBackendPicker')
    expect(picker?.props.backendId).toBe('harness:codex')
    expect((picker?.props.backends as Array<{ id: string; models: Array<{ id: string }> }>).find((backend) => backend.id === 'harness:codex')?.models)
      .toEqual([{ id: 'gpt-one', label: 'GPT One' }])
    expect(page.nodes().some((node) => node.type === 'Button' && node.props.label === 'Retry model list')).toBe(false)
    expect(page.get.mock.calls.filter(([path]) => path === modelsRoute)).toHaveLength(2)
    page.root.dispose()
  })
})
