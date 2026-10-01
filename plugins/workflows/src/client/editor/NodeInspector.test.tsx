import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentProviderDescriptor } from '@acorn/plugin-agents/contract/wire.ts'
import type { WorkflowCatalog, WorkflowDef } from '../../shared/workflowContracts'
import { newDraft, type WorkflowDraft } from './draft'

// The inspector in jsdom, because the whole point of `describe` is that a plugin's step kind gets a
// form nobody wrote by hand — and "the right control for the right field type" is a claim only a
// render can check (docs/workflows.md § Contributed step kinds).

const fieldOptions = vi.fn<(route: string) => Promise<{ options: { value: string; label: string }[] }>>()
vi.mock('../workflowsClient', () => ({ workflowApi: { fieldOptions: (route: string) => fieldOptions(route) } }))
vi.mock('@acorn/plugin-api/client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  activeTaskId: () => 'task-1',
}))

const { default: NodeInspector } = await import('./NodeInspector')

const catalog = (kinds: WorkflowCatalog['kinds']): WorkflowCatalog => ({
  kinds,
  policies: [{ id: 'no-secrets', pluginId: null }],
  profiles: [{ id: 'claude-code', label: 'Claude Code', managed: true, structured: true }],
  workflows: [{
    ref: { source: 'database', id: 'review-row' },
    name: 'Review ticket',
    inputs: [{ name: 'ticket', description: 'Ticket number', required: true }],
  }],
})

const providers: AgentProviderDescriptor[] = [{
  id: 'claude', profileId: 'claude-code', label: 'Claude Code', driverKind: 'acp', driverVersion: '1',
  installed: true, authenticated: true, statusAuthority: 'driver', capabilities: [],
  configOptions: [
    { id: 'model', label: 'Model', category: 'model', currentValue: 'sonnet', values: [{ value: 'opus', label: 'Opus' }] },
    { id: 'reasoning', label: 'Reasoning', category: 'reasoning', currentValue: null, values: [{ value: 'high', label: 'High' }] },
  ],
  commands: [], skills: [], diagnostics: [],
}] as unknown as AgentProviderDescriptor[]

const noActions = {
  rename: vi.fn(), setField: vi.fn(), setStep: vi.fn(), setDefinition: vi.fn(),
  setInputs: vi.fn(), connect: vi.fn(), disconnect: vi.fn(), remove: vi.fn(),
  addForEach: vi.fn(), createChild: vi.fn(),
}

let host: HTMLDivElement
let dispose: (() => void) | undefined

const mount = (def: WorkflowDef, kinds: WorkflowCatalog['kinds'], selected: string): void => {
  const draft: WorkflowDraft = { ...newDraft(def), selection: { kind: 'node', name: selected } }
  host = document.createElement('div')
  document.body.append(host)
  dispose = render(() => (
    <NodeInspector
      draft={draft}
      catalog={catalog(kinds)}
      providers={providers}
      projectId="p-1"
      workspaceId="w-1"
      actions={noActions}
    />
  ), host)
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
const labels = (selector: string) => [...host.querySelectorAll(selector)].map((el) => el.getAttribute('aria-label'))

beforeEach(() => {
  fieldOptions.mockReset()
  fieldOptions.mockResolvedValue({ options: [{ value: 'dev', label: 'Dev server' }] })
})
afterEach(() => {
  dispose?.()
  host?.remove()
})

describe('a contributed kind draws its own form', () => {
  const kind: WorkflowCatalog['kinds'][number] = {
    id: 'terminal:command',
    pluginId: 'terminal',
    describe: {
      label: 'Run a command',
      description: 'Run a command.', icon: 'terminal', output: { description: 'Command output.' },
      fields: [
        { id: 'command', label: 'Command', type: 'textarea', required: true },
        { id: 'timeoutMs', label: 'Timeout', type: 'number', min: 1000, max: 600000 },
        { id: 'allowFailure', label: 'Allow failure', type: 'boolean' },
      ],
    },
  }

  it('renders one control per field, of the type the description named', () => {
    mount({ baseline: 'acorn-1' as const, formatVersion: 1 as const, name: 'w', steps: [{ name: 'run', kind: 'terminal:command', after: [] }] }, [kind], 'run')
    expect(labels('textarea')).toContain('Command')
    const number = host.querySelector('input[aria-label="Timeout"]')
    expect(number?.getAttribute('aria-label')).toBe('Timeout')
    expect(number?.getAttribute('min')).toBe('1000')
    expect(host.querySelector('input[type="checkbox"]')).toBeTruthy()
  })

  it('marks a required field that is empty', () => {
    mount({ baseline: 'acorn-1' as const, formatVersion: 1 as const, name: 'w', steps: [{ name: 'run', kind: 'terminal:command', after: [] }] }, [kind], 'run')
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('has to be filled in')
  })

  it('does not mark it once it has a value', () => {
    mount({ baseline: 'acorn-1' as const, formatVersion: 1 as const, name: 'w', steps: [{ name: 'run', kind: 'terminal:command', after: [], with: { command: 'ls' } }] }, [kind], 'run')
    expect(host.querySelector('[role="alert"]')).toBeNull()
  })
})

it('keeps a missing plugin step and its raw settings visible', () => {
  mount({ baseline: 'acorn-1', formatVersion: 1, name: 'w', steps: [
    { name: 'send', kind: 'mail:send', after: [], with: { recipient: 'team' } },
  ] }, [], 'send')
  expect(host.textContent).toContain("Plugin 'mail' does not provide workflow step 'mail:send'")
  expect((host.querySelector('textarea[aria-label="Settings"]') as HTMLTextAreaElement)?.value).toContain('"recipient": "team"')
})

describe('a select with an options route', () => {
  const kind: WorkflowCatalog['kinds'][number] = {
    id: 'terminal:run-target',
    pluginId: 'terminal',
    describe: {
      label: 'Start a run target',
      description: 'Start a run target.', icon: 'play', output: { description: 'Target result.' },
      fields: [{ id: 'target', label: 'Run target', type: 'select', optionsRoute: '/v1/p/terminal/tasks/{taskId}/run-targets' }],
    },
  }

  it('substitutes the placeholder and offers what the route answered', async () => {
    mount({ baseline: 'acorn-1' as const, formatVersion: 1 as const, name: 'w', steps: [{ name: 'serve', kind: 'terminal:run-target', after: [] }] }, [kind], 'serve')
    await settle()
    expect(fieldOptions).toHaveBeenCalledWith('/v1/p/terminal/tasks/task-1/run-targets')
    expect([...host.querySelectorAll('option')].map((option) => option.textContent)).toContain('Dev server')
  })

  it('refuses a route outside the contributing plugin, and asks for the value by hand instead', async () => {
    const stolen = { ...kind, describe: { ...kind.describe!, fields: [{ ...kind.describe!.fields[0], optionsRoute: '/v1/p/agents/providers' }] } }
    mount({ baseline: 'acorn-1' as const, formatVersion: 1 as const, name: 'w', steps: [{ name: 'serve', kind: 'terminal:run-target', after: [] }] }, [stolen], 'serve')
    await settle()
    expect(fieldOptions).not.toHaveBeenCalled()
    expect(labels('input[type="text"]')).toContain('Run target')
  })
})

describe('a kind that runs an agent', () => {
  const kind: WorkflowCatalog['kinds'][number] = {
    id: 'agent',
    pluginId: null,
    describe: { label: 'Ask an agent', description: 'Ask an agent.', icon: 'bot', output: { description: 'Agent answer.' }, runsAgent: true, fields: [{ id: 'prompt', label: 'Prompt', type: 'prompt' }] },
  }

  it('edits a custom step timeout without changing the other budget limits', () => {
    mount({ baseline: 'acorn-1', formatVersion: 1, name: 'w', steps: [{
      name: 'ask', prompt: 'Investigate.', budget: { maxWallTimeMs: 1_800_000, maxTurns: 2 },
    }] }, [kind], 'ask')
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Step timeout in minutes"]')!
    expect(input.value).toBe('30')
    input.value = '45'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    expect(noActions.setStep).toHaveBeenLastCalledWith('ask', { budget: { maxWallTimeMs: 2_700_000, maxTurns: 2 } })
  })

  it('draws the harness, every option that harness advertises, and where it runs', () => {
    mount({ baseline: 'acorn-1' as const, formatVersion: 1 as const, name: 'w', steps: [{ name: 'ask', after: [], profileId: 'claude-code' }] }, [kind], 'ask')
    const named = labels('button.ui-select')
    expect(named).toContain('Harness')
    expect(named).toContain('Model')
    expect(named).toContain('Reasoning')
    const segments = [...host.querySelectorAll('.ui-segments')].map((el) => el.getAttribute('aria-label'))
    expect(segments).toEqual(['Where it runs', 'Upstream output'])
  })

  it('offers a reference chip for each declared input and each step that runs first', () => {
    const def: WorkflowDef = { baseline: 'acorn-1' as const, formatVersion: 1 as const,
      name: 'w',
      inputs: [{ name: 'issue' }],
      steps: [{ name: 'first', after: [] }, { name: 'ask', after: ['first'], profileId: 'claude-code' }],
    }
    mount(def, [kind], 'ask')
    const chips = [...host.querySelectorAll('.ui-chip-label')].map((el) => el.textContent)
    expect(chips).toContain('${inputs.issue}')
    expect(chips).toContain('${steps.first.output}')
  })

  it('does not draw agent fields for a kind that does not run one', () => {
    const gate: WorkflowCatalog['kinds'][number] = { id: 'gate-human', pluginId: null, describe: { label: 'Wait for a person', description: 'Wait for approval.', icon: 'hand', output: { description: 'Approval outcome.' }, fields: [] } }
    mount({ baseline: 'acorn-1' as const, formatVersion: 1 as const, name: 'w', steps: [{ name: 'review', kind: 'gate-human', after: [] }] }, [gate], 'review')
    expect(labels('button.ui-select')).not.toContain('Harness')
  })
})

describe('runtime workflow fields', () => {
  const kinds: WorkflowCatalog['kinds'] = [
    { id: 'workflow', pluginId: null, describe: { label: 'Run a workflow', description: 'Run a child workflow.', icon: 'workflow', output: { description: 'Child result.' }, fields: [{ id: 'childWorkflow', label: 'Child workflow', type: 'child-workflow' }] } },
    { id: 'workflow-map', pluginId: null, describe: { label: 'Map to workflows', description: 'Run child workflows.', icon: 'git-fork', output: { description: 'Child results.' }, fields: [{ id: 'childWorkflow', label: 'Child workflow', type: 'child-workflow' }] } },
  ]

  it('offers the scoped child target and its declared required input', () => {
    mount({ baseline: 'acorn-1' as const, formatVersion: 1 as const,
      name: 'w',
      inputs: [{ name: 'ticket' }],
      steps: [{
        name: 'review',
        kind: 'workflow',
        after: [],
        childWorkflow: { ref: { source: 'database', id: 'review-row' } },
      }],
    }, kinds, 'review')
    expect(labels('button.ui-select')).toContain('Child workflow')
    expect(host.textContent).toContain('Review ticket')
    expect(host.textContent).toContain('Choose a field')
    expect(host.textContent).toContain('Ticket number')
  })

  it('keeps an unavailable target visible and names the invalid draft', () => {
    mount({ baseline: 'acorn-1' as const, formatVersion: 1 as const,
      name: 'w',
      steps: [{
        name: 'review',
        kind: 'workflow',
        after: [],
        childWorkflow: { ref: { source: 'database', id: 'removed-row' } },
      }],
    }, kinds, 'review')
    expect(host.textContent).toContain('not available')
    expect(host.textContent).toContain('This workflow is not available to the selected project.')
  })

  it('offers structured predecessors through the shared records picker without requiring a pointer field', async () => {
    mount({ baseline: 'acorn-1' as const, formatVersion: 1 as const,
      name: 'w',
      steps: [
        { name: 'plain', after: [], prompt: 'Write prose.' },
        { name: 'tickets', after: [], prompt: 'Select tickets.', schema: { type: 'object' } },
        {
          name: 'review',
          kind: 'workflow-map',
          after: ['plain', 'tickets'],
          items: { step: 'tickets', pointer: 'tickets' },
          itemKey: '__proto__',
          childWorkflow: { ref: { source: 'database', id: 'review-row' } },
          title: { template: 'Review ${ticket}', bindings: { ticket: { from: 'item', pointer: '/number' } } },
        },
      ],
    }, kinds, 'review')
    const picker = host.querySelector<HTMLButtonElement>('button[aria-label="Records to process"]')
    expect(picker).not.toBeNull()
    expect(labels('input')).not.toContain('Array JSON Pointer')
  })
})

describe('typed data fields', () => {
  it('edits structured agent output as fields instead of raw schema JSON', () => {
    mount({ baseline: 'acorn-1' as const, formatVersion: 1 as const, name: 'w', steps: [{ id: 'agent', name: 'Analyse', after: [], schema: {
      type: 'object', properties: { severity: { type: 'string' } }, required: ['severity'],
    } }] }, [], 'agent')
    expect(host.textContent).toContain('Describe the fields the agent returns')
    expect(labels('input')).toContain('Field name')
    expect(labels('textarea')).not.toContain('Result schema')
  })

  it('edits an If condition with the shared typed field picker', () => {
    mount({ baseline: 'acorn-1' as const, formatVersion: 1 as const, name: 'w', inputs: [{ name: 'severity', schema: { type: 'string' } }], steps: [{
      id: 'if', name: 'Urgent?', kind: 'if', after: [],
      condition: { kind: 'comparison', left: { address: { from: 'input', name: 'severity', pointer: '' } }, operator: 'eq', right: { address: { from: 'literal', value: 'urgent' } } },
    }] }, [], 'if')
    expect(labels('button')).toContain('Field')
    expect(host.textContent).toContain('Choose a typed field')
    expect(labels('textarea')).not.toContain('Condition')
  })

  it('uses the shared binding picker for a record and offers compatible workflow inputs', async () => {
    mount({ baseline: 'acorn-1' as const, formatVersion: 1 as const,
      name: 'w',
      inputs: [{ name: 'record', description: 'Selected record', schema: { type: 'object', properties: { ref: { type: 'object' } }, required: ['ref'] } }],
      steps: [{ name: 'details', kind: 'get-record-details', after: [], record: { address: { from: 'input', name: 'record', pointer: '/ref' } } }],
    }, [], 'details')
    const picker = [...host.querySelectorAll('button')].find(button => button.getAttribute('aria-label') === 'Record reference')
    expect(picker?.textContent).toContain('Selected record')
    picker?.click()
    await settle()
    expect(document.body.textContent).toContain('Workflow inputs')
    expect(document.body.textContent).toContain('ref')
  })
})

describe('a human gate', () => {
  const gateDef = (form?: unknown): WorkflowDef => ({
    baseline: 'acorn-1', formatVersion: 1, name: 'W',
    steps: [
      { id: 'draft', name: 'draft', prompt: 'Draft it.', schema: { type: 'object', properties: { title: { type: 'string' } } } },
      { id: 'approve', name: 'approve', kind: 'gate-human', after: ['draft'], ...(form ? { form } : {}) },
    ],
  } as WorkflowDef)
  const press = (label: string) => [...host.querySelectorAll('button')].find((el) => el.textContent?.trim() === label)!.click()

  it('adds a form, and lists each field with where its proposal comes from', async () => {
    mount(gateDef(), [], 'approve')
    await settle()
    press('Add a form')
    expect(noActions.setStep).toHaveBeenLastCalledWith('approve', { form: { fields: [{ name: 'value', schema: { type: 'string' } }] } })

    dispose?.()
    host.remove()
    mount(gateDef({
      fields: [{ name: 'title', label: 'Title', schema: { type: 'string' } }, { name: 'note', schema: { type: 'string' } }],
      values: { title: { address: { from: 'step', stepId: 'draft', pointer: '/title' } } },
    }), [], 'approve')
    await settle()
    expect(host.textContent).toContain('Title: draft/title')
    expect(host.textContent).toContain('note: left for the reviewer to fill')
    expect(host.textContent).toContain('values.title')
  })
})
