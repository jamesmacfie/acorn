import { describe, expect, it } from 'vitest'
import type { WorkflowDef } from '../../shared/workflowContracts'
import { definitionForPrompt, restoreProtectedDefinition } from './edit'

const current: WorkflowDef = { baseline: 'acorn-1' as const, formatVersion: 1 as const,
  name: 'Deploy',
  trigger: 'schedule:nightly',
  tools: { maxRisk: 'execute', allow: ['deploy'] },
  steps: [
    {
      name: 'prepare',
      prompt: 'Prepare.',
      model: 'private-model',
      configOptions: { reasoning: 'high' },
      requiresRun: 'release',
      tools: { maxRisk: 'write', allow: ['pnpm build'] },
    },
    {
      name: 'send',
      kind: 'http:request',
      with: { method: 'POST', url: 'https://old.example', auth: 'secret-auth', headers: { Authorization: 'Bearer secret' } },
    },
  ],
}

describe('the model-visible definition', () => {
  it('keeps editable workflow content and removes protected configuration', () => {
    const visible = definitionForPrompt(current)
    expect(visible.trigger).toBeUndefined()
    expect(visible.tools).toEqual({ maxRisk: 'execute' })
    expect(visible.steps[0]).toMatchObject({ name: 'prepare', prompt: 'Prepare.', tools: { maxRisk: 'write' } })
    expect(visible.steps[0]?.model).toBeUndefined()
    expect(visible.steps[0]?.configOptions).toBeUndefined()
    expect(visible.steps[1]?.with).toEqual({ method: 'POST', url: 'https://old.example' })
  })
})

describe('protected configuration restoration', () => {
  it('restores hidden values only onto a surviving step of the same kind', () => {
    const changed: WorkflowDef = { baseline: 'acorn-1' as const, formatVersion: 1 as const,
      name: 'Safer deploy',
      tools: { maxRisk: 'read' },
      steps: [
        { name: 'prepare', prompt: 'Prepare carefully.' },
        { name: 'send', kind: 'http:request', with: { method: 'PUT', url: 'https://new.example' } },
      ],
    }
    const restored = restoreProtectedDefinition(current, changed)
    expect(restored).toMatchObject({ trigger: 'schedule:nightly', tools: { maxRisk: 'read', allow: ['deploy'] } })
    expect(restored.steps[0]).toMatchObject({
      prompt: 'Prepare carefully.',
      model: 'private-model',
      configOptions: { reasoning: 'high' },
      requiresRun: 'release',
      tools: { allow: ['pnpm build'] },
    })
    expect(restored.steps[1]?.with).toEqual({
      method: 'PUT',
      url: 'https://new.example',
      auth: 'secret-auth',
      headers: { Authorization: 'Bearer secret' },
    })

    const changedKind = restoreProtectedDefinition(current, { baseline: 'acorn-1' as const, formatVersion: 1 as const, name: 'Deploy', steps: [{ name: 'send', prompt: 'Now use an agent.' }] })
    expect(changedKind.steps[0]?.with).toBeUndefined()
  })

  it('does not restore a changed child target after grounding', () => {
    const configured: WorkflowDef = { baseline: 'acorn-1' as const, formatVersion: 1 as const,
      name: 'Dispatch',
      steps: [{
        name: 'review',
        kind: 'workflow',
        childWorkflow: {
          ref: { source: 'database', id: 'approved-target' },
          inputs: { ticket: { from: 'input', name: 'ticket' } },
        },
      }],
    }
    const visible = definitionForPrompt(configured)
    expect(visible.steps[0]?.childWorkflow).not.toHaveProperty('ref')
    expect(visible.steps[0]?.childWorkflow?.inputs).toEqual(configured.steps[0]?.childWorkflow?.inputs)

    const attemptedChange = restoreProtectedDefinition(configured, { baseline: 'acorn-1' as const, formatVersion: 1 as const,
      name: 'Dispatch',
      steps: [{
        name: 'review',
        kind: 'workflow',
        childWorkflow: { ref: { source: 'database', id: 'invented-target' } },
      }],
    })
    expect(attemptedChange.steps[0]?.childWorkflow?.ref).toEqual({ source: 'database', id: 'invented-target' })

    const renamed = restoreProtectedDefinition(configured, { baseline: 'acorn-1' as const, formatVersion: 1 as const,
      name: 'Dispatch',
      steps: [{
        name: 'different',
        kind: 'workflow',
        childWorkflow: { ref: { source: 'database', id: 'replacement' } },
      }],
    })
    expect(renamed.steps[0]?.childWorkflow?.ref).toEqual({ source: 'database', id: 'replacement' })

    const changedKind = restoreProtectedDefinition(configured, { baseline: 'acorn-1' as const, formatVersion: 1 as const,
      name: 'Dispatch',
      steps: [{ name: 'review', prompt: 'Review in this task.' }],
    })
    expect(changedKind.steps[0]?.childWorkflow).toBeUndefined()

    const duplicate = restoreProtectedDefinition(configured, { baseline: 'acorn-1' as const, formatVersion: 1 as const,
      name: 'Dispatch',
      steps: [
        { name: 'review', kind: 'workflow', childWorkflow: { ref: { source: 'database', id: 'first' } } },
        { name: 'review', kind: 'workflow', childWorkflow: { ref: { source: 'database', id: 'second' } } },
      ],
    })
    expect(duplicate.steps.map((step) => step.childWorkflow?.ref)).toEqual([
      { source: 'database', id: 'first' },
      { source: 'database', id: 'second' },
    ])
  })
})
