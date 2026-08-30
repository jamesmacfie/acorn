import { afterEach, describe, expect, it, vi } from 'vitest'
import { _resetHttpPanelModel, groupByFolder, httpPanelModel, type PanelSubject } from './panelModel'
import type { HttpRequest } from '../shared/model'

// The API pane is `list-detail`, so its two regions are two entries in this bundle that the host
// mounts side by side. What makes that possible is here: one model per subject, in module scope, so
// the list and the detail are looking at the same selection and the same draft (docs/panes.md §
// Layout model). A compiled pane gets the equivalent from the host's `model` seam.

const selects: ((item: string) => void)[] = []
const bridge = () => ({
  onSelect: (handler: (item: string) => void) => {
    selects.push(handler)
    return () => {}
  },
  ui: { copy: vi.fn() },
} as unknown as PanelSubject['bridge'])

const subject = (over: Partial<PanelSubject> = {}): PanelSubject => ({
  bridge: bridge(),
  projectId: 'p1',
  projectName: 'acorn',
  ...over,
})

afterEach(() => {
  _resetHttpPanelModel()
  selects.length = 0
})

describe('the model both regions share', () => {
  it('hands the same object to a second asker with the same subject', () => {
    const first = httpPanelModel(subject())
    expect(httpPanelModel(subject())).toBe(first)
    // A change the list makes is a change the detail sees, because there is only one of these.
    first.setSelection({ kind: 'variables' })
    expect(httpPanelModel(subject()).selection()).toEqual({ kind: 'variables' })
  })

  it('builds a new one when the subject changes, and drops the old', () => {
    const inProject = httpPanelModel(subject())
    const inTask = httpPanelModel(subject({ taskId: 't1' }))
    expect(inTask).not.toBe(inProject)
    expect(inTask.taskId).toBe('t1')
  })

  it('subscribes to the host’s selection once, not once per region', () => {
    httpPanelModel(subject())
    httpPanelModel(subject())
    // Two regions mounted, one bridge, one handler. Two would open the same request twice.
    expect(selects).toHaveLength(1)
  })
})

describe('groupByFolder', () => {
  const row = (name: string, folder: string): HttpRequest => ({ id: name, folder, name } as HttpRequest)

  it('puts the ungrouped first and sorts the rest by name', () => {
    expect(groupByFolder([row('b', 'auth'), row('a', ''), row('a', 'auth')]).map((g) => [g.folder, g.requests.map((r) => r.name)]))
      .toEqual([['', ['a']], ['auth', ['a', 'b']]])
  })
})
