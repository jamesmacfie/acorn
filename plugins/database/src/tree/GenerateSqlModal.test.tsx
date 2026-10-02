import { describe, expect, it, vi } from 'vitest'
import { AcornBridgeError } from '@acorn/plugin-api/ui/sdk'
import { createRemoteRoot } from '@acorn/plugin-api/testkit/client'
import { solidTree } from '@acorn/plugin-api/ui/tree'
import type { AcornBridge } from '@acorn/plugin-api/ui/sdk'
import GenerateSqlModal, { errorMessage } from './GenerateSqlModal'

const generateSql = vi.fn()

// What a failed generate reads as. A table rather than a render: the mapping is a pure function and
// each row is one sentence. A `.test.tsx` because the module it comes from draws kit nodes, and only
// the jsdom tier can load that entrypoint: a node-env test cannot import a Solid component.

const failed = (code: string, message = 'raw') =>
  new AcornBridgeError({ code, message, retryable: false, requestId: 'r1' })

describe('what a failed generate reads as', () => {
  it('sends a rejected key back to Settings', () => {
    expect(errorMessage(failed('provider_needs_auth'))).toContain('Reconnect it in Settings')
  })

  it('says to wait when the provider is rate-limiting', () => {
    expect(errorMessage(failed('provider_rate_limited'))).toContain('rate-limiting')
  })

  // An installed CLI that is signed out fails as `provider_unavailable`, the same code an unreachable
  // provider gets. Retrying does not fix it: the next step is to run the CLI once in a terminal.
  it('sends a silent CLI to a terminal, and leaves a silent provider alone', () => {
    expect(errorMessage(failed('provider_unavailable'), { kind: 'harness', label: 'Claude Code' }))
      .toBe('Claude Code did not answer. Run it once in a terminal to check it is signed in.')
    expect(errorMessage(failed('provider_unavailable', 'The provider did not answer.'), { kind: 'connection', label: 'Anthropic' }))
      .toBe('The provider did not answer. Try again shortly.')
  })

  it('falls back to the node prose, and then to whatever was thrown', () => {
    expect(errorMessage(failed('db_schema_unavailable', 'The schema script exited 1.'))).toBe('The schema script exited 1.')
    expect(errorMessage(new Error('Boom.'))).toBe('Boom.')
    expect(errorMessage('not an error at all')).toBe('not an error at all')
  })
})

it.each(['accepted', 'refused'])('keeps the dialog open until host replacement is %s', async (outcome) => {
  let complete: (result: { sql: string }) => void = () => {}
  generateSql.mockImplementation(() => new Promise((resolve) => { complete = resolve }))
  const root = createRemoteRoot(() => {})
  const onDismiss = vi.fn()
  let accept!: () => void
  let refuse!: (cause: Error) => void
  const replacement = new Promise<void>((resolve, reject) => { accept = resolve; refuse = reject })
  const onGenerated = vi.fn(() => replacement)
  let unmount = () => {}
  solidTree(GenerateSqlModal)({} as AcornBridge, {
    entry: 'generate',
    root,
    props: () => ({
      client: { generateSql },
      taskId: 'task-1',
      backends: [{ id: 'harness:test', kind: 'harness', label: 'Test', models: [], defaultModelId: '' }],
      queries: [],
      onDismiss,
      onGenerated,
    }),
    onProps: () => {},
    onUnmount: (dispose) => { unmount = dispose },
    host: {
      invoke: () => Promise.reject(new Error('this fixture answers no host requests')),
      openOverlay: () => Promise.reject(new Error('this fixture answers no host requests')),
    },
  })
  const nodes = () => {
    const found: typeof root.node.children = []
    const visit = (node: typeof root.node) => {
      found.push(node)
      node.children.forEach(visit)
    }
    root.node.children.forEach(visit)
    return found
  }
  const textarea = nodes().find((node) => node.type === 'Textarea')
  expect(textarea).toBeDefined()
  ;(textarea?.props.onChange as (value: string) => void)('Show the latest orders')
  const submit = nodes().filter((node) => node.type === 'Button').at(-1)
  expect(submit).toBeDefined()
  ;(submit?.props.onPress as () => void)()
  await Promise.resolve()

  const modal = nodes().find((node) => node.type === 'Modal')
  ;(modal?.props.onDismiss as () => void)()
  expect(onDismiss).not.toHaveBeenCalled()
  expect(onGenerated).not.toHaveBeenCalled()

  complete({ sql: 'SELECT * FROM orders;' })
  await Promise.resolve()
  await Promise.resolve()
  expect(onGenerated).toHaveBeenCalledWith('SELECT * FROM orders;')
  expect(onDismiss).not.toHaveBeenCalled()
  if (outcome === 'accepted') {
    accept()
    await vi.waitFor(() => expect(onDismiss).toHaveBeenCalledTimes(1))
  } else {
    refuse(new Error('Document changed while loading'))
    await vi.waitFor(() => expect(nodes().some((node) => String(node.props.value ?? '').includes('Document changed while loading'))).toBe(true))
    expect(onDismiss).not.toHaveBeenCalled()
    expect(nodes().find((node) => node.type === 'Textarea')?.props.value).toBe('Show the latest orders')
  }
  unmount()
  root.dispose()
})
