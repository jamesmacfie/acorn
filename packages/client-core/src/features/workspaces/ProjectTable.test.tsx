import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Project } from '@acorn/protocol/api.ts'
import { ProjectTable, type ProjectGroup } from './ProjectTable'
import { setWorkspaceProjectOrder } from './workspaceMutations'

vi.mock('./workspaceMutations', () => ({
  setWorkspaceProjectOrder: vi.fn(), patchProject: vi.fn(), createWorkspace: vi.fn(),
}))

const project = (id: string, workspaceId = 'work'): Project => ({
  id, name: id, workspaceId, sort: 0, hidden: false, path: `/src/${id}`, color: null,
  vcs: 'git', defaultBranch: 'main', remoteUrl: null, github: null,
})
let host: HTMLDivElement
let dispose: () => void
let hit: HTMLElement | null
const originalHitTest = Object.getOwnPropertyDescriptor(document, 'elementFromPoint')
beforeEach(() => {
  vi.mocked(setWorkspaceProjectOrder).mockReset().mockResolvedValue({ ok: true })
  host = document.createElement('div')
  document.body.append(host)
  hit = null
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => hit })
})
afterEach(() => {
  dispose?.()
  host.remove()
  vi.restoreAllMocks()
  if (originalHitTest) Object.defineProperty(document, 'elementFromPoint', originalHitTest)
  else Reflect.deleteProperty(document, 'elementFromPoint')
})

function mount(refresh = vi.fn(async () => {})) {
  const [groups, setGroups] = createSignal<ProjectGroup[]>([
    { id: 'work', workspaceId: 'work', label: 'Work', projects: [project('a'), project('b'), project('c')] },
    { id: 'other', workspaceId: 'other', label: 'Other', projects: [project('d', 'other'), project('e', 'other')] },
  ])
  const openProject = vi.fn()
  dispose = render(() => <ProjectTable groups={groups()} workspaces={[]} groupHeads taskCount={() => 0} openProject={openProject} refresh={refresh} />, host)
  return { refresh, openProject, setGroups }
}
const handle = (id: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="Reorder ${id}"]`)!
const rows = () => [...host.querySelectorAll('th[scope="row"] .ws-project-name')].map((name) => name.textContent)
const pointer = (target: EventTarget, type: string, y = 0) => target.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0, clientX: 10, clientY: y }))
function pointAt(id: string) {
  hit = handle(id).closest('tr')!
  vi.spyOn(hit, 'getBoundingClientRect').mockReturnValue({ top: 10, height: 30 } as DOMRect)
}

describe('project ordering in the shared settings table', () => {
  it('drags into the indicated position, saves the workspace order, and keeps selection and navigation separate', async () => {
    let saved!: () => void
    vi.mocked(setWorkspaceProjectOrder).mockImplementation(() => new Promise((resolve) => { saved = () => resolve({ ok: true }) }))
    const { openProject, refresh, setGroups } = mount()
    host.querySelector<HTMLInputElement>('input[aria-label="Select c"]')!.click()
    pointer(handle('c'), 'pointerdown')
    pointAt('a')
    pointer(window, 'pointermove', 12)
    expect(host.querySelector('[data-drop-position="before"]')).not.toBeNull()
    pointer(window, 'pointerup', 12)
    expect(setWorkspaceProjectOrder).toHaveBeenCalledWith('work', ['c', 'a', 'b'])
    expect(rows()).toEqual(['c', 'a', 'b', 'd', 'e'])
    expect(handle('c').disabled).toBe(true)
    expect(openProject).not.toHaveBeenCalled()
    setGroups([
      { id: 'work', workspaceId: 'work', label: 'Work', projects: [project('c'), project('a'), project('b')] },
      { id: 'other', workspaceId: 'other', label: 'Other', projects: [project('d', 'other'), project('e', 'other')] },
    ])
    saved()
    await vi.waitFor(() => expect(handle('c').disabled).toBe(false))
    expect(refresh).toHaveBeenCalledOnce()
    expect(host.querySelector<HTMLInputElement>('input[aria-label="Select c"]')!.checked).toBe(true)
    expect(document.activeElement).toBe(handle('c'))
  })

  it.each(['other workspace', 'outside', 'Escape', 'pointercancel', 'unmount'])('cancels a drag on %s without saving or opening a project', (reason) => {
    const { openProject } = mount()
    pointer(handle('a'), 'pointerdown')
    pointAt('c')
    pointer(window, 'pointermove', 38)
    if (reason === 'other workspace') { pointAt('d'); pointer(window, 'pointerup', 38) }
    else if (reason === 'outside') { hit = host; pointer(window, 'pointerup', 38) }
    else if (reason === 'Escape') {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      pointer(window, 'pointerup', 38)
      handle('a').click()
      expect(document.querySelector('[role="menu"]')).toBeNull()
    } else if (reason === 'unmount') { dispose(); pointer(window, 'pointerup', 38) }
    else pointer(window, 'pointercancel')
    expect(setWorkspaceProjectOrder).not.toHaveBeenCalled()
    expect(openProject).not.toHaveBeenCalled()
    expect(document.body.style.userSelect).not.toBe('none')
  })

  it('offers keyboard moves and restores the server order when saving fails', async () => {
    vi.mocked(setWorkspaceProjectOrder).mockRejectedValue(new Error('Node is offline.'))
    const { refresh, openProject } = mount()
    handle('b').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', altKey: true, bubbles: true }))
    expect(rows()).toEqual(['b', 'a', 'c', 'd', 'e'])
    await vi.waitFor(() => expect(host.textContent).toContain('Node is offline.'))
    await vi.waitFor(() => expect(rows()).toEqual(['a', 'b', 'c', 'd', 'e']))
    expect(refresh).toHaveBeenCalledOnce()
    expect(openProject).not.toHaveBeenCalled()
  })

  it('opens a move menu on a click and disables moves past the workspace edge', async () => {
    const { openProject } = mount()
    handle('a').click()
    const items = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
    expect(items.find((item) => item.textContent === 'Move up')!.disabled).toBe(true)
    items.find((item) => item.textContent === 'Move down')!.click()
    await vi.waitFor(() => expect(setWorkspaceProjectOrder).toHaveBeenCalledWith('work', ['b', 'a', 'c']))
    expect(openProject).not.toHaveBeenCalled()
  })
})
