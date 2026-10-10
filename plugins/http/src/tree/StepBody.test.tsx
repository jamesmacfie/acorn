import { describe, expect, it } from 'vitest'
import { sandboxMessage, type TreeMutation, type TreeNode } from '@acorn/protocol/tree/messages.ts'
import { createRemoteRoot } from '@acorn/plugin-api/testkit/client'
import type { AcornBridge } from '@acorn/plugin-api/ui/sdk'
import { solidTree } from '@acorn/plugin-api/ui/tree'
import type { WorkflowStepBodyProps } from '@acorn/plugin-workflows/contract/stepBody.ts'
import { HttpStepBodyApp, readStepResponse } from './StepBody'

// The `stepBody` entry the run pane mounts for an `http:request` step. Driven offline: what it emits
// is exactly what the worker would post, and it gets nothing but its props and a bridge.

const props = (over: Partial<WorkflowStepBodyProps> = {}): WorkflowStepBodyProps => ({
  taskId: 'task-1', projectId: 'project-1', runId: 'run-1', stepId: 'st-1', kind: 'http:request', status: 'done',
  inputs: null, inputsTruncated: false, outputTruncated: false, revision: 1,
  output: { status: 201, headers: { 'content-type': 'application/json' }, body: '{"id":7}' },
  ...over,
})

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

function mount(first: WorkflowStepBodyProps) {
  const operations: TreeMutation[] = []
  const root = createRemoteRoot((batch) => operations.push(...batch))
  let update: ((next: unknown) => void) | undefined
  solidTree<WorkflowStepBodyProps>(HttpStepBodyApp)({} as AcornBridge, {
    entry: 'stepBody',
    root,
    props: () => first,
    onProps: (callback) => { update = callback },
    onUnmount: () => {},
    host: {
      invoke: () => Promise.reject(new Error('the step body asks its owner for nothing')),
      openOverlay: () => Promise.reject(new Error('the step body opens no overlay')),
    },
  })
  const texts = (): string[] => {
    const out: string[] = []
    const visit = (node: TreeNode): void => {
      if (node.type === '#text') out.push(String(node.props.value))
      node.children.forEach(visit)
    }
    for (const operation of operations) {
      if (operation.op === 'insert') visit(operation.node)
      if (operation.op === 'text') out.push(operation.value)
    }
    return out
  }
  return { operations, texts, update: (next: WorkflowStepBodyProps) => update?.(next), dispose: () => root.dispose() }
}

describe('the http:request step body', () => {
  it('draws the stored response, with JSON laid out, as valid worker messages', async () => {
    const body = mount(props())
    await settle()
    expect(body.texts()).toContain('201')
    expect(body.texts()).toContain('{\n  "id": 7\n}')
    expect(sandboxMessage.safeParse({ kind: 'tree:batch', slot: 'step', ops: body.operations }).success).toBe(true)
    body.dispose()
  })

  it('keeps each mount to its own step, and redraws on new props', async () => {
    const first = mount(props({ stepId: 'st-1', output: { status: 200, headers: {}, body: 'one' } }))
    const second = mount(props({ stepId: 'st-2', output: { status: 404, headers: {}, body: 'two' } }))
    await settle()
    expect(first.texts()).toContain('one')
    expect(first.texts()).not.toContain('two')
    expect(second.texts()).toContain('404')

    first.update(props({ stepId: 'st-1', revision: 2, output: { status: 500, headers: {}, body: 'three' } }))
    await settle()
    expect(first.texts()).toContain('500')
    expect(second.texts()).not.toContain('three')
    first.dispose()
    second.dispose()
  })

  it('says it is sending while the step runs, and refuses output that is not a response', async () => {
    const running = mount(props({ status: 'running', output: null }))
    await settle()
    expect(running.texts()).toContain('Sending…')
    running.dispose()

    expect(readStepResponse({ status: '200' })).toBeNull()
    expect(readStepResponse(['nope'])).toBeNull()
    expect(readStepResponse({ status: 200, headers: { ok: 'yes', bad: 3 } })).toEqual({ status: 200, headers: [['ok', 'yes']], body: '' })
  })
})
