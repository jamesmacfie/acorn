import { describe, expect, it } from 'vitest'
import type { WorkflowDef } from '../../shared/workflowContracts'
import {
  addNode,
  applyJson,
  canConnect,
  connect,
  disconnect,
  effectiveAfter,
  graphOrder,
  missingRequiredFields,
  newDraft,
  pushUndo,
  removeNode,
  renameNode,
  setField,
  UNDO_DEPTH,
  type WorkflowDraft,
} from './draft'

// The rules that make the editor pleasant, as functions (docs/workflows.md § Authoring). Every one of
// them is a thing a person does by accident: renaming a step three prompts reference, deleting the
// middle of a chain, wiring an edge back into its own past.

const def = (): WorkflowDef => ({
  name: 'Investigate an issue',
  inputs: [{ name: 'issue', required: true }],
  steps: [
    { name: 'reproduce', after: [], prompt: 'Reproduce ${inputs.issue}' },
    { name: 'recent-changes', after: [], kind: 'terminal:command', with: { command: 'git log' } },
    { name: 'history', after: ['recent-changes'], prompt: 'Given ${steps.recent-changes.output}, why?' },
    { name: 'synthesise', after: ['reproduce', 'history'], prompt: 'Both said: ${steps.reproduce.output}' },
  ],
})

const draft = (selection?: WorkflowDraft['selection']): WorkflowDraft => ({
  ...newDraft(def()),
  ...(selection ? { selection } : {}),
})

const step = (current: WorkflowDraft, name: string) => current.def.steps.find((entry) => entry.name === name)

describe('the graph a definition describes', () => {
  it('reads a missing `after` as the step declared before it, so an old file keeps its chain', () => {
    const chain: WorkflowDef = { name: 'chain', steps: [{ name: 'a' }, { name: 'b' }, { name: 'c' }] }
    expect(effectiveAfter(chain, 0)).toEqual([])
    expect(effectiveAfter(chain, 1)).toEqual(['a'])
    expect(effectiveAfter(chain, 2)).toEqual(['b'])
  })

  it('puts each node after the last of its predecessors, indented by rank', () => {
    expect(graphOrder(def()).map((row) => [row.name, row.depth])).toEqual([
      ['reproduce', 0],
      ['recent-changes', 0],
      ['history', 1],
      ['synthesise', 2],
    ])
  })

  it('marks the node that waits on more than one step', () => {
    expect(graphOrder(def()).find((row) => row.name === 'synthesise')?.parents).toEqual(['reproduce', 'history'])
  })

  it('still draws every node when the graph has a cycle, so the footer is not the only sign', () => {
    const cyclic: WorkflowDef = {
      name: 'cyclic',
      steps: [{ name: 'a', after: ['b'] }, { name: 'b', after: ['a'] }],
    }
    expect(graphOrder(cyclic).map((row) => row.name)).toEqual(['a', 'b'])
  })
})

describe('renaming a node', () => {
  it('rewrites every reference and every `after` entry', () => {
    const renamed = renameNode(draft(), 'recent-changes', 'git-log')
    expect(step(renamed, 'history')?.after).toEqual(['git-log'])
    expect(step(renamed, 'history')?.prompt).toBe('Given ${steps.git-log.output}, why?')
    expect(renamed.def.steps.map((entry) => entry.name)).toContain('git-log')
    expect(renamed.def.steps.map((entry) => entry.name)).not.toContain('recent-changes')
  })

  it('rewrites a reference inside a `with` value as well as a prompt', () => {
    const start = newDraft({
      name: 'w',
      steps: [
        { name: 'one', after: [] },
        { name: 'two', after: ['one'], kind: 'terminal:command', with: { command: 'echo ${steps.one.output}' } },
      ],
    })
    expect(step(renameNode(start, 'one', 'first'), 'two')?.with?.command).toBe('echo ${steps.first.output}')
  })

  it('rewrites structured binding and map-source references', () => {
    const start = newDraft({
      name: 'w',
      steps: [
        { name: 'tickets', after: [], schema: { type: 'object' } },
        {
          name: 'review',
          kind: 'workflow-map',
          after: ['tickets'],
          items: { step: 'tickets', pointer: '/items' },
          itemKey: '/id',
          childWorkflow: {
            ref: { source: 'database', id: 'child' },
            inputs: { ticket: { from: 'step', step: 'tickets', pointer: '/ticket' } },
          },
          title: {
            template: 'Review ${ticket}',
            bindings: { ticket: { from: 'step', step: 'tickets', pointer: '/ticket' } },
          },
        },
      ],
    })
    const renamed = renameNode(start, 'tickets', 'selected-tickets')
    const review = step(renamed, 'review')
    expect(review?.items?.step).toBe('selected-tickets')
    expect(review?.childWorkflow?.inputs?.ticket).toMatchObject({ step: 'selected-tickets' })
    expect(review?.title?.bindings?.ticket).toMatchObject({ step: 'selected-tickets' })
  })

  it('carries the selection with the node', () => {
    const renamed = renameNode(draft({ kind: 'node', name: 'history' }), 'history', 'why')
    expect(renamed.selection).toEqual({ kind: 'node', name: 'why' })
  })

  it('refuses a duplicate and a name that is not slug-shaped, leaving the draft alone', () => {
    const start = draft()
    expect(renameNode(start, 'history', 'reproduce')).toBe(start)
    expect(renameNode(start, 'history', 'not a slug')).toBe(start)
  })
})

describe('adding and deleting', () => {
  it('adds after the selection, with one edge from it', () => {
    const added = addNode(draft({ kind: 'node', name: 'history' }), 'gate-human')
    const last = added.def.steps[added.def.steps.length - 1]
    expect(last.after).toEqual(['history'])
    expect(last.kind).toBe('gate-human')
    expect(added.selection).toEqual({ kind: 'node', name: last.name })
  })

  it('adds a root when nothing is selected', () => {
    expect(addNode(draft(), 'agent').def.steps.at(-1)?.after).toEqual([])
  })

  it('writes an explicit `after` on the steps it did not touch, so nothing inherits the new step', () => {
    const chain = newDraft({ name: 'chain', steps: [{ name: 'a' }, { name: 'b' }] })
    const added = addNode(chain, 'agent')
    expect(step(added, 'b')?.after).toEqual(['a'])
    expect(added.def.steps.at(-1)?.after).toEqual([])
  })

  it('detaches every edge and never bridges a predecessor to a successor', () => {
    const without = removeNode(draft(), 'history')
    expect(without.def.steps.map((entry) => entry.name)).toEqual(['reproduce', 'recent-changes', 'synthesise'])
    // `synthesise` keeps `reproduce` and loses `history`. It does not gain `recent-changes`.
    expect(step(without, 'synthesise')?.after).toEqual(['reproduce'])
  })

  it('moves the selection off a node it just deleted', () => {
    expect(removeNode(draft({ kind: 'node', name: 'history' }), 'history').selection).toEqual({ kind: 'definition' })
  })
})

describe('connecting', () => {
  it('refuses a self edge, a duplicate, and an edge that closes a cycle', () => {
    const current = def()
    expect(canConnect(current, 'history', 'history')).toBe(false)
    expect(canConnect(current, 'recent-changes', 'history')).toBe(false)
    expect(canConnect(current, 'synthesise', 'reproduce')).toBe(false)
    expect(canConnect(current, 'reproduce', 'history')).toBe(true)
  })

  it('adds and removes one edge', () => {
    const wired = connect(draft(), 'reproduce', 'history')
    expect(step(wired, 'history')?.after).toEqual(['recent-changes', 'reproduce'])
    expect(step(disconnect(wired, 'recent-changes', 'history'), 'history')?.after).toEqual(['reproduce'])
  })

  it('changes nothing when the edge is refused', () => {
    const start = draft()
    expect(connect(start, 'synthesise', 'reproduce')).toBe(start)
  })
})

describe('setting a field', () => {
  it('puts a built-in field on the step and a contributed one in `with`', () => {
    const withPrompt = setField(draft(), 'reproduce', 'agent', 'prompt', 'Do the thing')
    expect(step(withPrompt, 'reproduce')?.prompt).toBe('Do the thing')
    const withCommand = setField(draft(), 'recent-changes', 'terminal:command', 'timeoutMs', 5000)
    expect(step(withCommand, 'recent-changes')?.with).toEqual({ command: 'git log', timeoutMs: 5000 })
  })

  it('removes the key when the value is cleared', () => {
    const cleared = setField(draft(), 'reproduce', 'agent', 'prompt', '')
    expect('prompt' in (step(cleared, 'reproduce') ?? {})).toBe(false)
  })

  it('reaches a nested field, such as a fan-out child prompt', () => {
    const nested = setField(draft(), 'reproduce', 'fan-out', 'childStep.prompt', 'Each one')
    expect(step(nested, 'reproduce')?.childStep).toEqual({ prompt: 'Each one' })
  })
})

describe('the JSON tab', () => {
  it('replaces the draft atomically when the document is a definition', () => {
    const applied = applyJson(draft(), JSON.stringify({ name: 'Other', steps: [{ name: 'only' }] }))
    expect('draft' in applied && applied.draft.def.name).toBe('Other')
  })

  it('leaves the draft untouched for text that is not JSON, or is not a definition', () => {
    expect('error' in applyJson(draft(), '{ nope')).toBe(true)
    expect(applyJson(draft(), '{"steps": []}')).toEqual({ error: 'A workflow needs a name.' })
    expect(applyJson(draft(), '{"name": "x"}')).toEqual({ error: 'A workflow needs a list of steps.' })
    expect(applyJson(draft(), '{"name": "x", "steps": [{}]}')).toEqual({ error: 'Every step needs a name.' })
  })

  it('drops a selection the new document has no node for', () => {
    const applied = applyJson(draft({ kind: 'node', name: 'history' }), JSON.stringify({ name: 'x', steps: [{ name: 'only' }] }))
    expect('draft' in applied && applied.draft.selection).toEqual({ kind: 'definition' })
  })
})

describe('required fields', () => {
  const describeFor = (kind: string) =>
    (kind === 'terminal:command' ? { fields: [{ id: 'command', label: 'Command', type: 'textarea' as const, required: true }] } : undefined)

  it('names the step and the field, so Save can go grey before the node is asked', () => {
    expect(missingRequiredFields({ name: 'w', steps: [{ name: 'run', kind: 'terminal:command' }] }, describeFor))
      .toEqual(["step 'run' needs Command"])
  })

  it('says nothing once the box has something in it', () => {
    const filled: WorkflowDef = { name: 'w', steps: [{ name: 'run', kind: 'terminal:command', with: { command: 'ls' } }] }
    expect(missingRequiredFields(filled, describeFor)).toEqual([])
  })

  it('treats whitespace as empty', () => {
    const blank: WorkflowDef = { name: 'w', steps: [{ name: 'run', kind: 'terminal:command', with: { command: '  ' } }] }
    expect(missingRequiredFields(blank, describeFor)).toHaveLength(1)
  })
})

describe('undo history', () => {
  it('is bounded, and keeps the newest entries', () => {
    let stack: WorkflowDraft[] = []
    for (let n = 0; n < UNDO_DEPTH + 10; n += 1) {
      stack = pushUndo(stack, newDraft({ name: `v${n}`, steps: [] }))
    }
    expect(stack).toHaveLength(UNDO_DEPTH)
    expect(stack[0].def.name).toBe('v10')
    expect(stack.at(-1)?.def.name).toBe(`v${UNDO_DEPTH + 9}`)
  })
})
