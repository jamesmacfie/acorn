import { createRoot, createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, expect, it } from 'vitest'
import { createCollection, focusedCollectionTarget, revealCollectionItem } from './collection'
import { _resetCollectionState, collectionState } from './collectionState'

afterEach(_resetCollectionState)

it('captures the live focused row rather than the retained roving key', () => {
  const host = document.createElement('div')
  document.body.append(host)
  let retain!: (key: string) => void
  const dispose = render(() => {
    const collection = createCollection({
      id: () => 'tree.node.task',
      role: 'tree',
      items: () => [
        { key: 'old', label: 'Old' },
        { key: 'live', label: 'Live' },
      ],
    })
    retain = collection.focus
    return (
      <>
        <div {...collection.containerProps}>
          <button {...collection.itemProps('old')}>Old</button>
          <button {...collection.itemProps('live')}>Live</button>
        </div>
        <input />
      </>
    )
  }, host)
  try {
    host.querySelectorAll('button')[1].focus()
    retain('old')
    expect(focusedCollectionTarget()).toEqual({ id: 'tree.node.task', key: 'live' })
    host.querySelector('div')!.hidden = true
    expect(focusedCollectionTarget()).toBeUndefined()
    host.querySelector('input')!.focus()
    expect(focusedCollectionTarget()).toBeUndefined()
  } finally {
    dispose()
    host.remove()
  }
})

it('resolves row ids and tab stops with linear work on mount and refresh', () => {
  createRoot((dispose) => {
    try {
      let reads = 0
      const roster = Array.from({ length: 500 }, (_, index) => ({
        get key() {
          reads++
          return String(index)
        },
        label: `Session ${index}`,
      }))
      const [items, setItems] = createSignal(roster)
      const collection = createCollection({ id: () => 'large-roster', items, role: 'listbox' })
      const props = roster.map((_, index) => collection.itemProps(String(index)))
      const inspect = () => props.map((item) => [item.id, item.tabindex])
      expect(inspect()[0]).toEqual(['large-roster-item-0', 0])
      expect(reads).toBeLessThan(roster.length * 10)

      collection.focus('499')
      reads = 0
      expect(inspect()[499]).toEqual(['large-roster-item-499', 0])
      expect(reads).toBeLessThan(roster.length * 10)

      reads = 0
      setItems(roster.slice(0, 499).reverse())
      expect(props[498].id).toBe('large-roster-item-0')
      expect(props[498].tabindex).toBe(0)
      expect(props[0].tabindex).toBe(-1)
      expect(reads).toBeLessThan(roster.length * 10)
    } finally {
      dispose()
    }
  })
})

it('takes its registration back out when its id has moved on by the time it is disposed', () => {
  // A task-scoped id reads the task through props, and a task switch hands those props the next task
  // before it disposes the old view. A stale entry left registered would hold the old view.
  const [task, setTask] = createSignal('a')
  const dispose = createRoot((dispose) => {
    createCollection({ id: () => `list.${task()}`, items: () => [{ key: 'x', label: 'x' }], role: 'listbox' })
    return dispose
  })
  setTask('b')
  dispose()
  revealCollectionItem('list.a', 'x')
  expect(collectionState('list.a').active).toBeNull()
  expect(collectionState('list.b').active).toBeNull()
})
