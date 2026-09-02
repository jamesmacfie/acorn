import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Task } from '@acorn/plugin-api/client'
import { PrPane } from './PrPane'
import { prPaneContribution } from './paneContribution'
import { _resetPrTabs } from './prTabs'

// The PR pane is the navigator beside the diff, the same pair the browse surface draws
// (docs/panes.md § Layout model). Nothing rendered it until this package had a jsdom tier: phase 7
// deferred it and the pane has been unexercised since.
//
// What this holds is the shape rather than the content. The pane mounts, both columns draw, and
// nothing throws — which is the failure a broken import, a hook called outside a root, or a region
// name that drifted all produce. What a pull actually looks like is still the smoke checklist's
// (docs/testing.md).
//
// The query layer answers nothing on purpose. A pane with no data is the state a reader sees for the
// first few hundred milliseconds every single time, and it is the one that has to be safe.

vi.mock('@solidjs/router', () => ({
  useNavigate: () => () => {},
  useSearchParams: () => [{}, () => {}],
}))

vi.mock('@tanstack/solid-query', () => ({
  createQuery: () => ({ data: undefined, isLoading: true, isError: false }),
  createMutation: () => ({ mutate: () => {}, mutateAsync: async () => {}, isPending: false }),
  useQueryClient: () => ({
    invalidateQueries: async () => {},
    getQueryData: () => undefined,
    setQueryData: () => {},
    cancelQueries: async () => {},
  }),
}))

// Only the four seams that reach outside this render: the event bus, the socket, the pane-intent
// mailbox and task navigation. Everything else on this barrel is a pure function or a signal the real
// one answers correctly with no data, and mocking those would only test the mock.
vi.mock('@acorn/plugin-api/client', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    clientEvents: { on: () => () => {}, emit: () => {} },
    wsOnStatus: () => () => {},
    consumePaneIntent: () => undefined,
    activateTaskSignals: () => {},
  }
})

const task = {
  id: 't1',
  projectId: 'p1',
  title: 'Fix the rail',
  pullNumber: 7,
  github: { owner: 'runn-fast', name: 'acorn' },
} as unknown as Task

let host: HTMLElement
const disposers: (() => void)[] = []

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
})

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose()
  host.remove()
  _resetPrTabs()
})

describe('the PR pane', () => {
  it('is one region, drawn as the host\'s `single` layout', () => {
    expect(prPaneContribution.layout).toBe('single')
    expect(Object.keys(prPaneContribution.regions)).toEqual(['body'])
  })

  // The pane itself, not `regions.body`, which is the `lazy()` the contribution registers: a pending
  // lazy component needs the `Suspense` the pane registry puts around every region
  // (client-core host/registries/panes/panes.ts), and the assertion above is what holds the two to
  // the same component.
  const draw = () => {
    disposers.push(render(() => <PrPane task={task} />, host))
    return host
  }

  it('draws the navigator beside the diff', () => {
    const node = draw()
    // The kit's split, which is what makes this look like the browse surface rather than like a
    // second design (docs/panes.md § Layout model).
    expect(node.querySelector('.ui-listdetail')).not.toBeNull()
    expect(node.querySelector('[aria-label="Pull request"]')).not.toBeNull()
    expect(node.textContent ?? '').toContain('Diff')
  })

  it('draws the pull, its actions, its files and its conversation in the navigator', () => {
    const text = draw().textContent ?? ''
    // The number the pane was opened for, not a placeholder: the strip resolved the task's primary
    // pull with nothing but the task row, which is the path a cold open takes.
    expect(text).toContain('#7')
    expect(text).toContain('Merge')
    expect(text).toContain('Reviewers')
    expect(text).toContain('Files')
    expect(text).toContain('Comments/Commits')
  })
})
