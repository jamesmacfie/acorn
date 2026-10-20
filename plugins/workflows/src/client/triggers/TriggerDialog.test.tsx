import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkflowTriggerPreparation, WorkflowTriggerView } from '../../shared/workflowTriggers'

const preparation: WorkflowTriggerPreparation = {
  workflowName: 'Triage issues',
  limits: { maxDescendants: 80, maxConcurrency: 3, budget: { maxWallTimeMs: 7_200_000 } },
  loops: [
    {
      loopId: 'loop',
      label: 'Review issues',
      sourceLabel: 'Issues',
      checkpointAvailable: false,
      checkpointReason: 'This source does not promise a safe continuation checkpoint. Use a rolling window instead.',
      schema: { type: 'object', properties: { data: { type: 'object', properties: { state: { type: 'string' } } } } },
      fields: [{ pointer: '/data/state', label: 'State', origin: 'declared' }],
      setting: { loopId: 'loop', repeat: { mode: 'every-match' }, incremental: false },
    },
  ],
  changes: [],
}
const active: WorkflowTriggerView = {
  id: 'trigger',
  projectId: 'project',
  workflowId: 'workflow',
  workflowName: 'Triage issues',
  inputs: {},
  when: { kind: 'clock', timezone: 'Pacific/Auckland' },
  cadence: { daily: '09:00' },
  limits: preparation.limits,
  loops: preparation.loops.map((loop) => loop.setting),
  firstCheck: 'process-current',
  state: 'active',
  updatedAt: 1,
}
const prepareTrigger = vi.fn(async (_input: unknown) => preparation)
const saveTrigger = vi.fn(async (_input: unknown) => ({ ...active, state: 'draft' as const }))
const approveTrigger = vi.fn(async (_id: string, _first: string, _fresh: boolean) => active)

vi.mock('../workflowsClient', () => ({
  workflowApi: {
    triggerDefaults: async () => ({ timezone: 'Pacific/Auckland' }),
    prepareTrigger: (input: unknown) => prepareTrigger(input),
    saveTrigger: (input: unknown) => saveTrigger(input),
    approveTrigger: (id: string, first: string, fresh: boolean) => approveTrigger(id, first, fresh),
    pauseTrigger: async () => active,
    runTriggerNow: async () => active,
    deleteTrigger: async () => ({ deleted: true }),
  },
}))
vi.mock('@solidjs/router', () => ({ useNavigate: () => () => undefined }))
vi.mock('@tanstack/solid-query', () => ({
  createQuery: () => ({ data: [{ id: 'project', name: 'Project', status: 'active' }] }),
  useQueryClient: () => ({ invalidateQueries: async () => undefined }),
}))

const { default: TriggerDialogHost } = await import('./TriggerDialog')
const { closeWorkflowTrigger, requestWorkflowTrigger } = await import('./triggerRequest')

let host: HTMLDivElement
let dispose: (() => void) | undefined
const settle = async () => {
  for (let index = 0; index < 5; index += 1) await new Promise((resolve) => setTimeout(resolve, 0))
}
const press = async (label: string) => {
  const button = [...document.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === label,
  ) as HTMLButtonElement | undefined
  if (!button) throw new Error(`Missing button: ${label}`)
  button.click()
  await settle()
}

beforeEach(async () => {
  // The preview shows the next runs in Pacific/Auckland from the current date, so a real clock would
  // flip the expected offset to +13 whenever New Zealand is on daylight time. Only Date is faked, so
  // the timers `settle` waits on still run.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-07-01T00:00:00Z'))
  host = document.createElement('div')
  document.body.append(host)
  dispose = render(() => <TriggerDialogHost />, host)
  requestWorkflowTrigger({ workflowId: 'workflow', name: 'Triage issues', projectId: 'project', inputs: [] })
  await settle()
})

afterEach(() => {
  closeWorkflowTrigger()
  dispose?.()
  host.remove()
  vi.clearAllMocks()
  vi.useRealTimers()
})

describe('workflow trigger setup', () => {
  it('progressively reveals record policy, first check, concrete times, and limits', async () => {
    expect(document.body.textContent).toContain('On a schedule')
    expect(document.body.textContent).not.toContain('Repeat handling')
    expect(document.body.textContent).not.toContain('Activation is a separate device action')
    await press('Review activation')
    expect(document.body.textContent).toContain('Review issues · repeat handling')
    expect(document.body.textContent).toContain('Previously unseen records')
    expect(document.body.textContent).not.toContain('Since the last completed check')
    expect(document.body.textContent).toContain('Process current matches')
    expect(document.body.textContent).toContain('Up to 80 tasks, 3 at a time, 120 minutes.')
    expect(document.body.textContent?.match(/GMT\+12|UTC\+12/)).toBeTruthy()
  })

  it('saves a disabled draft separately and retains history on activation by default', async () => {
    await press('Review activation')
    await press('Save draft')
    expect(saveTrigger).toHaveBeenCalledOnce()
    expect(saveTrigger).toHaveBeenCalledWith(
      expect.objectContaining({ when: { kind: 'clock', timezone: 'Pacific/Auckland' } }),
    )
    expect(approveTrigger).not.toHaveBeenCalled()
    await press('Activate')
    expect(approveTrigger).toHaveBeenCalledWith('trigger', 'process-current', false)
  })

  it('reports an offline activation failure without retrying or queueing it', async () => {
    approveTrigger.mockRejectedValueOnce(new Error('Node offline'))
    await press('Review activation')
    await press('Activate')
    expect(document.body.textContent).toContain('Node offline')
    expect(approveTrigger).toHaveBeenCalledOnce()
    await settle()
    expect(approveTrigger).toHaveBeenCalledOnce()
  })
})
