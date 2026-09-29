import { render } from 'solid-js/web'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Task } from '@acorn/protocol/api.ts'
import { sourceRegistry } from '../../host/registries/sources/sources'
import { PromoteToTaskModal, type PromoteTaskAction } from './PromoteToTaskModal'
import type { Disposable } from '../../kit/lib/state/registry'

vi.mock('@solidjs/router', () => ({ useParams: () => ({ projectId: 'p1' }) }))
vi.mock('@tanstack/solid-query', () => ({
  createQuery: () => ({ get data() { return [{ id: 'p1', name: 'acorn', vcs: 'git' }] } }),
}))
vi.mock('../../infra/queries', () => ({ projectsOptions: () => ({}) }))
vi.mock('../tasks/taskBridge', () => ({
  taskBridge: () => ({ project: { get: async () => ({ config: { branchPrefix: null } }) } }),
}))

const TASK: Task = { id: 'task-9', title: 'Fix it', branch: 'james/fix-it' } as Task
let host: HTMLElement
let dispose: (() => void) | undefined
const registered: Disposable[] = []
const created = vi.fn(async () => TASK)
const attached = vi.fn(async () => {})
let seedBranch = 'james/typeerror'

const mount = (action?: PromoteTaskAction, attachTasks: Task[] = []) => {
  registered.push(sourceRegistry.register({
    id: 'rollbar', order: 1, glyph: 'bug', label: 'Rollbar',
    promotion: {
      canPromote: () => true,
      prepare: () => ({ origin: 'rollbar', projectId: 'p1', title: 'TypeError', branch: seedBranch }),
      create: created,
      attachToCurrentTask: attached,
    },
  }))
  host = document.createElement('div')
  document.body.append(host)
  dispose = render(() => (
    <PromoteToTaskModal providerId="rollbar" item={{ id: 'RB-4412' }} itemTitle="TypeError in pullsBatch"
      headerLabel="Promote item" attachTasks={attachTasks} existingBranches={[]}
      {...(action ? { action } : {})} onClose={() => {}} onCreated={() => {}} onAttached={() => {}} />
  ), host)
}

const primary = () => [...document.querySelectorAll('button')].find((button) => button.type === 'submit')!
const inputs = () => [...document.querySelectorAll<HTMLInputElement>('input.ui-input')]
const type = (element: HTMLInputElement, value: string) => {
  element.value = value
  element.dispatchEvent(new Event('input', { bubbles: true }))
}
const settle = async () => { for (let tick = 0; tick < 4; tick += 1) await Promise.resolve() }

afterEach(() => {
  seedBranch = 'james/typeerror'
  created.mockClear()
  attached.mockClear()
  dispose?.()
  host?.remove()
  for (const handle of registered.splice(0)) handle.dispose()
})

describe('the optional task action', () => {
  it('leaves ordinary promotion unchanged', async () => {
    mount()
    await settle()
    expect(primary().textContent).toBe('Create task')
    expect(inputs()).toHaveLength(2)
    primary().click()
    await settle()
    expect(created).toHaveBeenCalledOnce()
  })

  it('renders caller content and respects its readiness', async () => {
    mount({ content: <span>Choose an operation</span>, label: 'run', ready: () => false, onTaskReady: vi.fn() })
    await settle()
    expect(document.body.textContent).toContain('Choose an operation')
    expect(primary().disabled).toBe(true)
  })

  it('reuses a created task after a failed action', async () => {
    const onTaskReady = vi.fn().mockRejectedValueOnce(new Error('start failed')).mockResolvedValue(undefined)
    mount({ content: <span>Run</span>, label: 'run', ready: () => true, onTaskReady })
    await settle()
    primary().click()
    await settle()
    expect(document.body.textContent).toContain('start failed')
    expect(primary().textContent).toBe('Retry run')
    primary().click()
    await settle()
    expect(created).toHaveBeenCalledOnce()
    expect(onTaskReady).toHaveBeenCalledTimes(2)
    expect(onTaskReady).toHaveBeenNthCalledWith(2, TASK)
  })

  it('reuses an attached task after a failed action', async () => {
    const onTaskReady = vi.fn().mockRejectedValueOnce(new Error('start failed')).mockResolvedValue(undefined)
    mount({ content: <span>Run</span>, label: 'run', ready: () => true, onTaskReady }, [TASK])
    await settle()
    document.querySelector<HTMLButtonElement>('button[role="tab"]:last-child')?.click()
    const attachButton = [...document.querySelectorAll('button')].find((button) => button.type === 'submit' && button.textContent?.includes('Attach'))!
    attachButton.click()
    await settle()
    expect(document.body.textContent).toContain('start failed')
    attachButton.click()
    await settle()
    expect(attached).toHaveBeenCalledOnce()
    expect(onTaskReady).toHaveBeenCalledTimes(2)
  })
})

describe('the branch field', () => {
  it('derives the branch from the title when the source does not seed one', async () => {
    seedBranch = ''
    mount()
    await settle()
    const [titleField, branchField] = inputs()
    expect(branchField.value).toBe('typeerror')
    type(titleField, 'Fix Login Crash!')
    primary().click()
    await settle()
    expect(created).toHaveBeenCalledWith(expect.objectContaining({ branch: 'fix-login-crash' }))
  })

  it('keeps a seeded branch verbatim', async () => {
    seedBranch = 'dependabot/npm_and_yarn/dev-dependencies-0e84c50104'
    mount()
    await settle()
    primary().click()
    await settle()
    expect(created).toHaveBeenCalledWith(expect.objectContaining({ branch: seedBranch }))
  })

  it('slugs a typed branch and refuses an unusable name', async () => {
    mount()
    await settle()
    const branchField = inputs()[1]
    type(branchField, 'Fix Login Crash!')
    primary().click()
    await settle()
    expect(created).toHaveBeenCalledWith(expect.objectContaining({ branch: 'fix-login-crash' }))
    created.mockClear()
    type(branchField, '!!!')
    expect(primary().disabled).toBe(true)
  })
})

describe('the setup script', () => {
  it('runs by default', async () => {
    mount()
    await settle()
    primary().click()
    await settle()
    expect(created).toHaveBeenCalledWith(expect.objectContaining({ skipSetup: false }))
  })

  it('can be skipped', async () => {
    mount()
    await settle()
    document.querySelector<HTMLInputElement>('input.ui-check-box')!.click()
    primary().click()
    await settle()
    expect(created).toHaveBeenCalledWith(expect.objectContaining({ skipSetup: true }))
  })
})
