import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Task } from '@acorn/plugin-api/client'
import { prPaneContribution } from './PrPane'
import { _resetPrTabs } from './prTabs'

// The PR pane is a `tabs` layout, so Overview, Conversation and Files are three components the host
// mounts one at a time (docs/panes.md § Layout model). Nothing rendered them until this package had a
// jsdom tier: phase 7 deferred it and the panels have been unexercised since.
//
// What this holds is the shape rather than the content. Every panel mounts, every panel draws the
// pull strip its model gives it, and none of them throws — which is the failure a broken import, a
// hook called outside a root, or a region name that drifted from the tab list all produce. What a
// pull actually looks like is still the smoke checklist's (docs/testing.md).
//
// The query layer answers nothing on purpose. A panel with no data is the state a reader sees for the
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
  it('names one region per declared tab, and no others', () => {
    expect(prPaneContribution.tabs?.map((tab) => tab.id)).toEqual(['overview', 'conversation', 'files'])
    expect(Object.keys(prPaneContribution.regions).sort())
      .toEqual(['panel:conversation', 'panel:files', 'panel:overview'])
  })

  const draw = (region: string) => {
    const Panel = prPaneContribution.regions[region]!
    disposers.push(render(() => <Panel task={task} model={undefined} />, host))
    return host
  }

  it('draws the pull and its actions on the overview tab', () => {
    const text = draw('panel:overview').textContent ?? ''
    // The number the pane was opened for, not a placeholder: the strip resolved the task's primary
    // pull with nothing but the task row, which is the path a cold open takes.
    expect(text).toContain('#7')
    expect(text).toContain('Merge')
    expect(text).toContain('Reviewers')
  })

  it('draws the review composer and the empty timeline on the conversation tab', () => {
    const text = draw('panel:conversation').textContent ?? ''
    expect(text).toContain('Approve')
    expect(text).toContain('Request changes')
    expect(text).toContain('No comments or commits.')
  })

  it('draws the file list beside the diff on the files tab', () => {
    const node = draw('panel:files')
    // A `ListDetail` inside the region, which is the split this pane keeps for itself: the pane's own
    // arrangement is the host's tab bar, and a split inside one panel is a different object
    // (docs/panes.md § Layout model).
    expect(node.querySelector('.ui-listdetail')).not.toBeNull()
    expect(node.querySelector('[aria-label="Changed files"]')).not.toBeNull()
  })
})
