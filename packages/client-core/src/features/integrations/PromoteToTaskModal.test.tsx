import { render } from 'solid-js/web'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Task } from '@acorn/protocol/api.ts'
import type { WorkflowDefSummary } from '@acorn/protocol/workflow.ts'
import { sourceRegistry } from '../../host/registries/sources/sources'
import { PromoteToTaskModal } from './PromoteToTaskModal'
import type { Disposable } from '../../kit/lib/registry'

// The workflow step over the promote modal (docs/workflows.md § Starting a run). What only a render
// can show: the primary button refuses while a required input is empty, and the run is started on the
// task this modal just made rather than on whatever was routed.
//
// The rest of the modal — prepare, create, attach — is the source's registered `promotion` and is
// covered where that lives (host/chrome/promotion.test.ts).

vi.mock('@solidjs/router', () => ({ useParams: () => ({ projectId: 'p1' }) }))
vi.mock('@tanstack/solid-query', () => ({
  createQuery: () => ({ get data() { return [{ id: 'p1', name: 'acorn', vcs: 'git' }] } }),
}))
vi.mock('../../infra/queries', () => ({ projectsOptions: () => ({}) }))

const TASK: Task = { id: 'task-9', title: 'Fix it', branch: 'james/fix-it' } as Task

const DEF: WorkflowDefSummary = {
  id: 'db:1',
  name: 'Investigate an issue',
  source: 'database',
  inputs: [{ name: 'issue', required: true }, { name: 'focus' }],
  steps: [{ name: 'reproduce' }],
}

let host: HTMLElement
let dispose: (() => void) | undefined
const registered: Disposable[] = []

const created = vi.fn(async () => TASK)

const mount = (workflow?: Parameters<typeof PromoteToTaskModal>[0]['workflow']) => {
  registered.push(sourceRegistry.register({
    id: 'rollbar',
    order: 1,
    glyph: 'bug',
    label: 'Rollbar',
    promotion: {
      canPromote: () => true,
      prepare: () => ({ origin: 'rollbar', projectId: 'p1', title: 'TypeError', branch: 'james/typeerror' }),
      create: created,
    },
  }))
  host = document.createElement('div')
  document.body.append(host)
  dispose = render(() => (
    <PromoteToTaskModal
      providerId="rollbar"
      item={{ id: 'RB-4412' }}
      itemTitle="TypeError in pullsBatch"
      headerLabel="Start a workflow — TypeError in pullsBatch"
      attachTasks={[]}
      existingBranches={[]}
      {...(workflow ? { workflow } : {})}
      onClose={() => {}}
      onCreated={() => {}}
      onAttached={() => {}}
    />
  ), host)
}

const primary = () => [...host.querySelectorAll('button')].find((button) => button.type === 'submit')!
const inputs = () => [...host.querySelectorAll<HTMLInputElement>('input.ui-input')]
/** A workflow input by the name it was declared under; the kit puts that on `aria-label`. */
const field = (name: string) => host.querySelector<HTMLInputElement>(`input[aria-label="${name}"]`)!
const type = (element: HTMLInputElement, value: string) => {
  element.value = value
  element.dispatchEvent(new Event('input', { bubbles: true }))
}
/** The modal seeds its title and branch from `prepare`, through a promise. Nothing is answerable
 *  until that lands. */
const settle = async () => { for (let tick = 0; tick < 4; tick += 1) await Promise.resolve() }

afterEach(() => {
  created.mockClear()
  dispose?.()
  host?.remove()
  for (const handle of registered.splice(0)) handle.dispose()
})

describe('the workflow step', () => {
  it('is absent, and the button unchanged, for the plain promote flow', async () => {
    mount()
    await settle()
    expect(primary().textContent).toBe('Create task')
    // Title and branch, and nothing asked about a workflow.
    expect(inputs()).toHaveLength(2)
  })

  it('refuses while a required input is empty and takes the button with it', async () => {
    mount({ definitions: [DEF], onStart: vi.fn(async () => {}) })
    await settle()
    // The title came from `prepare`, so the only thing still missing is the workflow's own input.
    expect(primary().textContent?.trim()).toBe('Create & run')
    expect(primary().disabled).toBe(true)
  })

  it('runs the workflow on the task it just made, with what was typed', async () => {
    const onStart = vi.fn(async () => {})
    mount({ definitions: [DEF], prefill: { issue: 'TypeError in pullsBatch' }, onStart })
    await settle()

    // The prefill fills the required input, so the button is live before anything is typed.
    expect(primary().disabled).toBe(false)
    // The step is drawn above the tabs, so `issue` and `focus` come before title and branch in the
    // document. By name, then, not by position.
    type(field('focus'), 'the retry change')
    primary().click()
    await settle()

    expect(created).toHaveBeenCalled()
    expect(onStart).toHaveBeenCalledWith('task-9', 'db:1', {
      issue: 'TypeError in pullsBatch',
      focus: 'the retry change',
    })
  })
})
