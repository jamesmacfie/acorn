import { afterEach, describe, expect, it, vi } from 'vitest'
import { _resetHttpPanelModel, groupByFolder, httpPanelModel, type PanelSubject } from './panelModel'
import type { HttpRequest } from '../shared/model'

// The API pane is `list-detail`, so its two regions are two entries in this bundle that the host
// mounts side by side. What makes that possible is here: one model per subject, in module scope, so
// the list and the detail are looking at the same selection and the same draft (docs/panes.md §
// Layout model). A compiled pane gets the equivalent from the host's `model` seam.

const selects: ((item: string) => void)[] = []
const actions: ((command: string) => void)[] = []
// `context` is the host's snapshot at connect, and `item` in it is the row that OPENED the pane: a task
// pane has no URL to hold a selection, so a click or the palette's curl import arrives this way
// (docs/plugins.md § The tree contract).
const bridge = (item?: string) => ({
  context: { surface: 'http', target: 'remote', nodeId: 'node-a', ...(item ? { item } : {}) },
  onSelect: (handler: (item: string) => void) => {
    selects.push(handler)
    return () => {}
  },
  onSurfaceAction: (handler: (command: string) => void) => {
    actions.push(handler)
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
  actions.length = 0
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

  // The palette's `New request` row. It is a surface action rather than a node route because a new
  // request is a draft in the pane, not a row on the node — the same thing the "+ Request" button does.
  it('starts a new draft on the palette’s new-request command, and ignores any other', () => {
    const model = httpPanelModel(subject({ taskId: 't1' }))
    model.setSelection({ kind: 'variables' })
    expect(actions).toHaveLength(1)
    actions[0]('something-else')
    expect(model.selection()).toEqual({ kind: 'variables' })
    actions[0]('new-request')
    expect(model.selection()).toEqual({ kind: 'new' })
    expect(model.draft()).toMatchObject({ name: 'New request', method: 'GET', url: '', taskId: 't1' })
  })

  // The curl import answers with the row it created and the success action opens the pane. On a pane
  // that was closed there is no `select` message to catch, so the id rides in `context`.
  it('takes the selection that opened the pane from the bridge context', () => {
    const model = httpPanelModel(subject({ bridge: bridge('request-9') }))
    expect(model.selection()).toEqual({ kind: 'new' })
    // Nothing is open yet: the row it names arrives with the list, and the model's effect waits for it.
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
