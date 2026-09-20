import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkflowSchedulePreparation, WorkflowScheduleView } from '../../shared/workflowSchedules'

const preparation: WorkflowSchedulePreparation = {
  workflowName: 'Triage issues',
  limits: { maxDescendants: 80, maxConcurrency: 3, budget: { maxWallTimeMs: 7_200_000 } },
  loops: [{
    loopId: 'loop', label: 'Review issues', sourceLabel: 'Issues', checkpointAvailable: false,
    checkpointReason: 'This source does not promise a safe continuation checkpoint. Use a rolling window instead.',
    schema: { type: 'object', properties: { data: { type: 'object', properties: { state: { type: 'string' } } } } },
    fields: [{ pointer: '/data/state', label: 'State', origin: 'declared' }],
    setting: { loopId: 'loop', repeat: { mode: 'every-match' }, incremental: false },
  }],
  changes: [],
}
const active: WorkflowScheduleView = {
  id: 'schedule', projectId: 'project', workflowId: 'workflow', workflowName: 'Triage issues',
  inputs: {}, timezone: 'Pacific/Auckland', cadence: { daily: '09:00' }, limits: preparation.limits,
  loops: preparation.loops.map(loop => loop.setting), firstCheck: 'process-current', state: 'active', updatedAt: 1,
}
const prepareSchedule = vi.fn(async (_input: unknown) => preparation)
const saveSchedule = vi.fn(async (_input: unknown) => ({ ...active, state: 'draft' as const }))
const approveSchedule = vi.fn(async (_id: string, _first: string, _fresh: boolean) => active)

vi.mock('../workflowsClient', () => ({ workflowApi: {
  scheduleDefaults: async () => ({ timezone: 'Pacific/Auckland' }),
  prepareSchedule: (input: unknown) => prepareSchedule(input),
  saveSchedule: (input: unknown) => saveSchedule(input),
  approveSchedule: (id: string, first: string, fresh: boolean) => approveSchedule(id, first, fresh),
  pauseSchedule: async () => active,
  runScheduleNow: async () => active,
  deleteSchedule: async () => ({ deleted: true }),
} }))
vi.mock('@solidjs/router', () => ({ useNavigate: () => () => undefined }))
vi.mock('@tanstack/solid-query', () => ({
  createQuery: () => ({ data: [{ id: 'project', name: 'Project', status: 'active' }] }),
  useQueryClient: () => ({ invalidateQueries: async () => undefined }),
}))

const { default: ScheduleDialogHost } = await import('./ScheduleDialog')
const { closeWorkflowSchedule, requestWorkflowSchedule } = await import('./scheduleRequest')

let host: HTMLDivElement
let dispose: (() => void) | undefined
const settle = async () => { for (let index = 0; index < 5; index += 1) await new Promise(resolve => setTimeout(resolve, 0)) }
const press = async (label: string) => {
  const button = [...document.querySelectorAll('button')].find(candidate => candidate.textContent?.trim() === label) as HTMLButtonElement | undefined
  if (!button) throw new Error(`Missing button: ${label}`)
  button.click()
  await settle()
}

beforeEach(async () => {
  host = document.createElement('div')
  document.body.append(host)
  dispose = render(() => <ScheduleDialogHost />, host)
  requestWorkflowSchedule({ workflowId: 'workflow', name: 'Triage issues', projectId: 'project', inputs: [] })
  await settle()
})

afterEach(() => {
  closeWorkflowSchedule()
  dispose?.()
  host.remove()
  vi.clearAllMocks()
})

describe('workflow schedule setup', () => {
  it('progressively reveals record policy, first check, concrete times, and limits', async () => {
    expect(document.body.textContent).not.toContain('Repeat handling')
    expect(document.body.textContent).toContain('Activation is a separate device action and is never queued while offline.')
    await press('Review activation')
    expect(document.body.textContent).toContain('Review issues · repeat handling')
    expect(document.body.textContent).toContain('Previously unseen records')
    expect(document.body.textContent).not.toContain('Since the last completed check')
    expect(document.body.textContent).toContain('Process current matches')
    expect(document.body.textContent).toContain('80 descendants · 3 at once · 2h maximum')
    expect(document.body.textContent?.match(/GMT\+12|UTC\+12/)).toBeTruthy()
  })

  it('saves a disabled draft separately and retains history on activation by default', async () => {
    await press('Review activation')
    await press('Save draft')
    expect(saveSchedule).toHaveBeenCalledOnce()
    expect(approveSchedule).not.toHaveBeenCalled()
    await press('Activate')
    expect(approveSchedule).toHaveBeenCalledWith('schedule', 'process-current', false)
  })

  it('reports an offline activation failure without retrying or queueing it', async () => {
    approveSchedule.mockRejectedValueOnce(new Error('Node offline'))
    await press('Review activation')
    await press('Activate')
    expect(document.body.textContent).toContain('Node offline')
    expect(approveSchedule).toHaveBeenCalledOnce()
    await settle()
    expect(approveSchedule).toHaveBeenCalledOnce()
  })
})
