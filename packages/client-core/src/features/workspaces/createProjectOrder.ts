import { createSignal, onCleanup } from 'solid-js'
import type { Project } from '@acorn/protocol/api.ts'
import { setWorkspaceProjectOrder } from './workspaceMutations'

type ProjectGroup = { workspaceId?: string; projects: readonly Project[] }
type DropTarget = { id: string; position: 'before' | 'after' }

/** The table owns its gesture and pending order; the Node owns the saved order. */
export function createProjectOrder(options: {
  groups: () => readonly ProjectGroup[]
  table: () => HTMLElement | undefined
  refresh: () => Promise<unknown>
}) {
  const [pending, setPending] = createSignal<{ workspaceId: string; ids: string[] }>()
  const [error, setError] = createSignal('')
  const [announcement, setAnnouncement] = createSignal('')
  const [dragId, setDragId] = createSignal<string>()
  const [dropTarget, setDropTarget] = createSignal<DropTarget>()
  let gesture: { id: string; workspaceId: string; x: number; y: number; pointerId: number } | undefined
  let suppressClick: { id: string; until: number } | undefined
  let restoreSelection: (() => void) | undefined

  const groupFor = (id: string) => options.groups().find((group) => group.projects.some((project) => project.id === id))
  const projectsFor = (group: ProjectGroup) => {
    const saving = pending()
    if (!saving || saving.workspaceId !== group.workspaceId) return group.projects
    const byId = new Map(group.projects.map((project) => [project.id, project]))
    return saving.ids.flatMap((id) => byId.get(id) ?? []).concat(group.projects.filter((project) => !saving.ids.includes(project.id)))
  }

  async function move(id: string, targetId: string, position: DropTarget['position']) {
    if (pending() || id === targetId) return
    const group = groupFor(id)
    if (!group?.workspaceId || !group.projects.some((project) => project.id === targetId)) return
    const ids = group.projects.map((project) => project.id).filter((projectId) => projectId !== id)
    ids.splice(ids.indexOf(targetId) + (position === 'after' ? 1 : 0), 0, id)
    if (ids.every((projectId, index) => projectId === group.projects[index].id)) return
    setPending({ workspaceId: group.workspaceId, ids })
    setError('')
    setAnnouncement('Saving project order…')
    try {
      await setWorkspaceProjectOrder(group.workspaceId, ids)
      await options.refresh()
      setAnnouncement('Project order saved.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save project order.')
      setAnnouncement('')
      await options.refresh().catch(() => undefined)
    } finally {
      setPending(undefined)
      // Index preserves controls across refetches, but a reorder changes which project a slot owns.
      // Follow the moved project so another keyboard move still acts on the same project.
      queueMicrotask(() => {
        const handle = [...options.table()?.querySelectorAll<HTMLElement>('.ws-project-reorder') ?? []]
          .find((element) => element.dataset.projectId === id)
        handle?.querySelector<HTMLButtonElement>('button')?.focus()
      })
    }
  }

  function shift(id: string, delta: -1 | 1) {
    const group = groupFor(id)
    const index = group?.projects.findIndex((project) => project.id === id) ?? -1
    const target = group?.projects[index + delta]
    if (index >= 0 && target) void move(id, target.id, delta === -1 ? 'before' : 'after')
  }

  function clearGesture() {
    window.removeEventListener('pointermove', pointerMove)
    window.removeEventListener('pointerup', pointerUp)
    window.removeEventListener('pointercancel', cancel)
    window.removeEventListener('keydown', escape)
    window.removeEventListener('blur', cancel)
    restoreSelection?.()
    restoreSelection = undefined
    gesture = undefined
    setDragId(undefined)
    setDropTarget(undefined)
  }

  function cancel() {
    if (gesture && dragId()) suppressClick = { id: gesture.id, until: performance.now() + 500 }
    clearGesture()
  }

  function escape(event: KeyboardEvent) {
    if (event.key !== 'Escape') return
    event.preventDefault()
    cancel()
  }

  function pointerMove(event: PointerEvent) {
    if (!gesture || event.pointerId !== gesture.pointerId) return
    if (!dragId()) {
      if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) < 4) return
      setDragId(gesture.id)
      const selection = document.body.style.userSelect
      document.body.style.userSelect = 'none'
      restoreSelection = () => { document.body.style.userSelect = selection }
    }
    event.preventDefault()
    const row = document.elementFromPoint(event.clientX, event.clientY)?.closest('tr')
    const handle = row?.querySelector<HTMLElement>('.ws-project-reorder')
    const targetId = handle?.dataset.projectId
    const target = targetId ? groupFor(targetId) : undefined
    if (!row || !options.table()?.contains(row) || !targetId || targetId === gesture.id || target?.workspaceId !== gesture.workspaceId) {
      setDropTarget(undefined)
      return
    }
    const box = row.getBoundingClientRect()
    setDropTarget({ id: targetId, position: event.clientY < box.top + box.height / 2 ? 'before' : 'after' })
  }

  function pointerUp(event: PointerEvent) {
    if (!gesture || event.pointerId !== gesture.pointerId) return
    // Hit-test the release too: releasing outside the table cancels a previously valid target.
    if (dragId()) pointerMove(event)
    const id = gesture.id
    const target = dropTarget()
    const dragged = !!dragId()
    if (dragged) suppressClick = { id, until: performance.now() + 500 }
    clearGesture()
    if (dragged && target) void move(id, target.id, target.position)
  }

  function begin(event: PointerEvent, id: string) {
    const group = groupFor(id)
    if (event.button !== 0 || pending() || !group?.workspaceId || group.projects.length < 2) return
    clearGesture()
    gesture = { id, workspaceId: group.workspaceId, x: event.clientX, y: event.clientY, pointerId: event.pointerId }
    window.addEventListener('pointermove', pointerMove, { passive: false })
    window.addEventListener('pointerup', pointerUp)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('keydown', escape)
    window.addEventListener('blur', cancel)
  }

  function consumeClick(id: string) {
    const consume = suppressClick?.id === id && performance.now() <= suppressClick.until
    suppressClick = undefined
    return consume
  }

  onCleanup(clearGesture)
  return { projectsFor, busy: () => !!pending(), error, announcement, dragId, dropTarget, begin, consumeClick, shift }
}
