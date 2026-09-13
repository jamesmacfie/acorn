import { createSignal, onCleanup } from 'solid-js'
import type { RailDropPosition } from './railOrder'

type RailDragItem = { id: string; parentId: string | null }
type DropTarget = { id: string; position: RailDropPosition }

export function createRailDrag(options: {
  items: () => readonly RailDragItem[]
  onDrop: (id: string, targetId: string, position: RailDropPosition) => void
}) {
  const [dragId, setDragId] = createSignal<string | null>(null)
  const [dropTarget, setDropTarget] = createSignal<DropTarget | null>(null)
  let gesture: { id: string; startX: number; startY: number } | undefined
  let suppressClick: { id: string; until: number } | undefined

  const canDropOn = (draggedId: string, target: RailDragItem) => {
    const dragged = options.items().find((item) => item.id === draggedId)
    // parentId is workflow/delegation lineage, not presentation state. A drag orders roots or
    // siblings; it must never look like it reparented a task when no authoritative relation changed.
    return !!dragged && dragged.id !== target.id && dragged.parentId === target.parentId
  }

  const positionAt = (clientY: number, row: HTMLElement): RailDropPosition => {
    const box = row.getBoundingClientRect()
    return clientY < box.top + box.height / 2 ? 'before' : 'after'
  }

  function clear() {
    window.removeEventListener('mousemove', move)
    window.removeEventListener('mouseup', end)
    gesture = undefined
    setDragId(null)
    setDropTarget(null)
  }

  function move(event: MouseEvent) {
    if (!gesture) return
    if (!dragId()) {
      if (Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) < 4) return
      setDragId(gesture.id)
    }
    event.preventDefault()
    const row = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('.tabrail-item')
    const target = row?.dataset.taskId
      ? options.items().find((item) => item.id === row.dataset.taskId)
      : undefined
    if (!row || !target || !canDropOn(gesture.id, target)) return setDropTarget(null)
    setDropTarget({ id: target.id, position: positionAt(event.clientY, row) })
  }

  function end(event: MouseEvent) {
    if (!gesture) return
    window.removeEventListener('mousemove', move)
    window.removeEventListener('mouseup', end)
    const dragged = gesture
    gesture = undefined
    const target = dropTarget()
    if (dragId() !== dragged.id) return clear()
    event.preventDefault()
    suppressClick = { id: dragged.id, until: performance.now() + 500 }
    setDragId(null)
    setDropTarget(null)
    if (target) options.onDrop(dragged.id, target.id, target.position)
  }

  function begin(event: MouseEvent, id: string) {
    if (event.button !== 0) return
    clear()
    gesture = { id, startX: event.clientX, startY: event.clientY }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', end)
  }

  function consumeClick(id: string): boolean {
    if (suppressClick?.id === id && performance.now() <= suppressClick.until) {
      suppressClick = undefined
      return true
    }
    suppressClick = undefined
    return false
  }

  onCleanup(clear)
  return { begin, consumeClick, dragId, dropTarget }
}
