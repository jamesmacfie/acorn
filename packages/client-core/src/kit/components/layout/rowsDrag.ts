import { createSignal, onCleanup } from 'solid-js'
import type { ReorderPosition } from './rowsReorder'

// Dragging a reorderable `Rows` row by its grip: the pointer gesture and the drop marker it draws.
// The same gesture as the project table's (features/workspaces/createProjectOrder.ts), keyed by row
// rather than by project. A row is the `.ui-rows-reorder` wrapper Rows draws around it.

const ROW = '.ui-rows-reorder'

export function createRowsDrag(options: {
  list: () => HTMLElement | undefined
  /** Whether a row can be dragged right now: it is movable, nothing is saving, and it has company. */
  canDrag: (key: string) => boolean
  canDrop: (key: string) => boolean
  drop: (key: string, target: string, position: ReorderPosition) => void
}) {
  const [dragKey, setDragKey] = createSignal<string>()
  const [dropTarget, setDropTarget] = createSignal<{ key: string; position: ReorderPosition }>()
  let gesture: { key: string; x: number; y: number; pointerId: number } | undefined
  let suppressClick: { key: string; until: number } | undefined
  let restoreSelection: (() => void) | undefined

  function clear() {
    window.removeEventListener('pointermove', pointerMove)
    window.removeEventListener('pointerup', pointerUp)
    window.removeEventListener('pointercancel', cancel)
    window.removeEventListener('keydown', escape)
    window.removeEventListener('blur', cancel)
    restoreSelection?.()
    restoreSelection = undefined
    gesture = undefined
    setDragKey(undefined)
    setDropTarget(undefined)
  }

  function cancel() {
    if (gesture && dragKey()) suppressClick = { key: gesture.key, until: performance.now() + 500 }
    clear()
  }

  function escape(event: KeyboardEvent) {
    if (event.key !== 'Escape') return
    event.preventDefault()
    cancel()
  }

  function pointerMove(event: PointerEvent) {
    if (!gesture || event.pointerId !== gesture.pointerId) return
    if (!dragKey()) {
      // A press that barely moves is a click on the grip, which opens its menu.
      if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) < 4) return
      setDragKey(gesture.key)
      const selection = document.body.style.userSelect
      document.body.style.userSelect = 'none'
      restoreSelection = () => {
        document.body.style.userSelect = selection
      }
    }
    event.preventDefault()
    const row = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>(ROW)
    const key = row?.dataset.reorderKey
    if (!row || !key || !options.list()?.contains(row) || key === gesture.key || !options.canDrop(key)) {
      setDropTarget(undefined)
      return
    }
    const box = row.getBoundingClientRect()
    setDropTarget({ key, position: event.clientY < box.top + box.height / 2 ? 'before' : 'after' })
  }

  function pointerUp(event: PointerEvent) {
    if (!gesture || event.pointerId !== gesture.pointerId) return
    // Hit-test the release too: letting go outside the list cancels a target it passed over.
    if (dragKey()) pointerMove(event)
    const key = gesture.key
    const target = dropTarget()
    const dragged = !!dragKey()
    if (dragged) suppressClick = { key, until: performance.now() + 500 }
    clear()
    if (dragged && target) options.drop(key, target.key, target.position)
  }

  function begin(event: PointerEvent, key: string) {
    if (event.button !== 0 || !options.canDrag(key)) return
    clear()
    gesture = { key, x: event.clientX, y: event.clientY, pointerId: event.pointerId }
    window.addEventListener('pointermove', pointerMove, { passive: false })
    window.addEventListener('pointerup', pointerUp)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('keydown', escape)
    window.addEventListener('blur', cancel)
  }

  /** The click that ends a drag is not a press on the grip. */
  function consumeClick(key: string) {
    const consume = suppressClick?.key === key && performance.now() <= suppressClick.until
    suppressClick = undefined
    return consume
  }

  onCleanup(clear)
  return { dragKey, dropTarget, begin, consumeClick }
}
