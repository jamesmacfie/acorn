import { describe, expect, it } from 'vitest'
import type { WorkflowStepRow } from '../shared/workflowContracts'
import { resolveChildWorkflowInputs, resolveWorkflowMapRoster } from './workflowBindings'

const step = (structured: unknown): WorkflowStepRow => ({
  id: 'source-step',
  runId: 'parent-run',
  idx: 0,
  name: 'source',
  kind: 'agent',
  mode: 'headless',
  profileId: null,
  model: null,
  status: 'done',
  worktreePath: null,
  inputsJson: null,
  resultJson: null,
  structuredJson: JSON.stringify(structured),
  sessionId: null,
  agentSessionId: null,
  costUsd: null,
  iteration: 0,
  parentStepId: null,
  error: null,
  createdAt: 1,
  updatedAt: 1,
})

describe('child workflow input bindings', () => {
  it('reads literals, frozen parent inputs, and safe structured-output pointers', () => {
    expect(resolveChildWorkflowInputs({
      literal: { from: 'literal', value: 'fixed' },
      parent: { from: 'input', name: 'fallback' },
      ticket: { from: 'step', step: 'source', pointer: '/tickets/0/number' },
      escaped: { from: 'step', step: 'source', pointer: '/a~1b/~0value' },
    }, { fallback: 'ABC-0' }, [step({
      tickets: [{ number: 'ABC-7' }],
      'a/b': { '~value': 'escaped' },
    })])).toEqual({ literal: 'fixed', parent: 'ABC-0', ticket: 'ABC-7', escaped: 'escaped' })
  })

  it('refuses missing, non-string, and prototype-traversing values', () => {
    const rows = [step({ ticket: { number: 7 } })]
    expect(() => resolveChildWorkflowInputs({
      ticket: { from: 'step', step: 'source', pointer: '/ticket/number' },
    }, {}, rows)).toThrow("Child input 'ticket' must resolve to a string")
    expect(() => resolveChildWorkflowInputs({
      ticket: { from: 'step', step: 'source', pointer: '/missing' },
    }, {}, rows)).toThrow('does not resolve to a value')
    expect(() => resolveChildWorkflowInputs({
      ticket: { from: 'step', step: 'source', pointer: '/constructor/name' },
    }, {}, rows)).toThrow('not a safe JSON Pointer')
  })

  it('freezes an ordered map roster from item, parent-input, and predecessor bindings', () => {
    const def = {
      name: 'dispatch',
      kind: 'workflow-map',
      items: { step: 'source', pointer: '/tickets' },
      itemKey: '/id',
      childWorkflow: {
        ref: { source: 'database' as const, id: 'child' },
        inputs: {
          ticket: { from: 'item' as const, pointer: '/number' },
          fallback: { from: 'input' as const, name: 'fallback' },
          batch: { from: 'step' as const, step: 'source', pointer: '/batch' },
        },
      },
      title: {
        template: '  Review\n${ticket}  ',
        bindings: { ticket: { from: 'item' as const, pointer: '/number' } },
      },
    }
    expect(resolveWorkflowMapRoster(def, { fallback: 'ABC-0' }, [step({
      batch: 'morning',
      tickets: [{ id: 'first', number: 'ABC-1' }, { id: 'second', number: 'ABC-2' }],
    })], { optional: 'default' })).toEqual({
      version: 1,
      entries: [
        {
          index: 0,
          itemKey: 'first',
          item: { id: 'first', number: 'ABC-1' },
          inputs: { optional: 'default', ticket: 'ABC-1', fallback: 'ABC-0', batch: 'morning' },
          title: 'Review ABC-1',
        },
        {
          index: 1,
          itemKey: 'second',
          item: { id: 'second', number: 'ABC-2' },
          inputs: { optional: 'default', ticket: 'ABC-2', fallback: 'ABC-0', batch: 'morning' },
          title: 'Review ABC-2',
        },
      ],
    })
  })

  it('refuses a non-array source, duplicate or empty keys, and non-string item inputs', () => {
    const definition = (structured: unknown, itemKey = '/id', inputPointer = '/number') => () => resolveWorkflowMapRoster({
      name: 'dispatch',
      kind: 'workflow-map',
      items: { step: 'source', pointer: '/tickets' },
      itemKey,
      childWorkflow: {
        ref: { source: 'database', id: 'child' },
        inputs: { ticket: { from: 'item', pointer: inputPointer } },
      },
      title: { template: '${ticket}', bindings: { ticket: { from: 'item', pointer: '/number' } } },
    }, {}, [step(structured)])

    expect(definition({ tickets: 'ABC-1' })).toThrow('must resolve to an array')
    expect(definition({ tickets: [{ id: 'same', number: 'ABC-1' }, { id: 'same', number: 'ABC-2' }] }))
      .toThrow("item key 'same' is repeated")
    expect(definition({ tickets: [{ id: '', number: 'ABC-1' }] })).toThrow('key must resolve to a nonempty string')
    expect(definition({ tickets: [{ id: 'one', number: { value: 'ABC-1' } }] })).toThrow("input 'ticket' must resolve to a string")
    expect(definition({ tickets: [{ id: 'one', number: 'ABC-1' }] }, '/constructor/name')).toThrow('not a safe JSON Pointer')
  })
})
