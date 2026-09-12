import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentProviderDescriptor } from '@acorn/protocol/managedAgents.ts'
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
      fields: [
        { id: 'command', label: 'Command', type: 'textarea', required: true },
        { id: 'timeoutMs', label: 'Timeout', type: 'number', min: 1000, max: 600000 },
        { id: 'allowFailure', label: 'Allow failure', type: 'boolean' },
      ],
    },
  }

  it('renders one control per field, of the type the description named', () => {
    mount({ name: 'w', steps: [{ name: 'run', kind: 'terminal:command', after: [] }] }, [kind], 'run')
    expect(labels('textarea')).toContain('Command')
    const number = host.querySelector('input[type="number"]')
    expect(number?.getAttribute('aria-label')).toBe('Timeout')
    expect(number?.getAttribute('min')).toBe('1000')
    expect(host.querySelector('input[type="checkbox"]')).toBeTruthy()
  })

  it('marks a required field that is empty', () => {
    mount({ name: 'w', steps: [{ name: 'run', kind: 'terminal:command', after: [] }] }, [kind], 'run')
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('has to be filled in')
  })

  it('does not mark it once it has a value', () => {
    mount({ name: 'w', steps: [{ name: 'run', kind: 'terminal:command', after: [], with: { command: 'ls' } }] }, [kind], 'run')
    expect(host.querySelector('[role="alert"]')).toBeNull()
  })
})

describe('a select with an options route', () => {
  const kind: WorkflowCatalog['kinds'][number] = {
    id: 'terminal:run-target',
    pluginId: 'terminal',
    describe: {
      label: 'Start a run target',
      fields: [{ id: 'target', label: 'Run target', type: 'select', optionsRoute: '/v2/p/terminal/tasks/{taskId}/run-targets' }],
    },
  }

  it('substitutes the placeholder and offers what the route answered', async () => {
    mount({ name: 'w', steps: [{ name: 'serve', kind: 'terminal:run-target', after: [] }] }, [kind], 'serve')
    await settle()
    expect(fieldOptions).toHaveBeenCalledWith('/v2/p/terminal/tasks/task-1/run-targets')
    expect([...host.querySelectorAll('option')].map((option) => option.textContent)).toContain('Dev server')
  })

  it('refuses a route outside the contributing plugin, and asks for the value by hand instead', async () => {
    const stolen = { ...kind, describe: { ...kind.describe!, fields: [{ ...kind.describe!.fields[0], optionsRoute: '/v2/p/agents/providers' }] } }
    mount({ name: 'w', steps: [{ name: 'serve', kind: 'terminal:run-target', after: [] }] }, [stolen], 'serve')
    await settle()
    expect(fieldOptions).not.toHaveBeenCalled()
    expect(labels('input[type="text"]')).toContain('Run target')
  })
})

describe('a kind that runs an agent', () => {
  const kind: WorkflowCatalog['kinds'][number] = {
    id: 'agent',
    pluginId: null,
    describe: { label: 'Ask an agent', runsAgent: true, fields: [{ id: 'prompt', label: 'Prompt', type: 'prompt' }] },
  }

  it('draws the harness, every option that harness advertises, and where it runs', () => {
    mount({ name: 'w', steps: [{ name: 'ask', after: [], profileId: 'claude-code' }] }, [kind], 'ask')
    const named = labels('button.ui-select')
    expect(named).toContain('Harness')
    expect(named).toContain('Model')
    expect(named).toContain('Reasoning')
    const segments = [...host.querySelectorAll('.ui-segments')].map((el) => el.getAttribute('aria-label'))
    expect(segments).toEqual(['Where it runs', 'Upstream output'])
  })

  it('offers a reference chip for each declared input and each step that runs first', () => {
    const def: WorkflowDef = {
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
    const gate: WorkflowCatalog['kinds'][number] = { id: 'gate-human', pluginId: null, describe: { label: 'Wait for a person', fields: [] } }
    mount({ name: 'w', steps: [{ name: 'review', kind: 'gate-human', after: [] }] }, [gate], 'review')
    expect(labels('button.ui-select')).not.toContain('Harness')
  })
})

describe('runtime workflow fields', () => {
  const kinds: WorkflowCatalog['kinds'] = [
    { id: 'workflow', pluginId: null, describe: { label: 'Run a workflow', fields: [{ id: 'childWorkflow', label: 'Child workflow', type: 'child-workflow' }] } },
    { id: 'workflow-map', pluginId: null, describe: { label: 'Map to workflows', fields: [{ id: 'childWorkflow', label: 'Child workflow', type: 'child-workflow' }] } },
  ]

  it('offers the scoped child target and its declared required input', () => {
    mount({
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
    expect(host.textContent).toContain('Choose where this required input comes from.')
    expect(host.textContent).toContain('Ticket number')
  })

  it('keeps an unavailable target visible and names the invalid draft', () => {
    mount({
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

  it('offers only structured predecessors as map sources and shows pointer validation', async () => {
    mount({
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
    host.querySelector<HTMLButtonElement>('button[aria-label="Source step"]')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle()
    const options = [...document.body.querySelectorAll('[role="option"]')].map((option) => option.textContent)
    expect(options).toContain('tickets')
    expect(options).not.toContain('plain')
    expect(host.textContent).toContain('Start a JSON Pointer with /')
  })
})
