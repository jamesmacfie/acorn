import { createSignal, Show } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, expect, it, vi } from 'vitest'
import { retainScroll } from './retainScroll'

// jsdom never clamps `scrollTop` (or lays anything out), so each scroller here gets a fake one that
// refuses any offset until its content has "arrived", the way a browser clamps an empty list to zero.

const offsets = new Map<string, number>()
const store = (key: () => string) => ({
  key,
  read: (at: string) => offsets.get(at) ?? 0,
  write: (at: string, offset: number) => {
    offsets.set(at, offset)
  },
})
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
const mounted: (() => void)[] = []
afterEach(() => {
  mounted.splice(0).forEach((dispose) => dispose())
  offsets.clear()
})

function mount(key: () => string, ready: () => boolean = () => true) {
  const host = document.createElement('div')
  document.body.append(host)
  let scroller!: HTMLDivElement
  let position = 0
  const dispose = render(
    () => (
      <div
        ref={(element) => {
          scroller = element
          Object.defineProperty(element, 'scrollTop', {
            configurable: true,
            get: () => position,
            set: (offset: number) => {
              position = ready() ? offset : 0
            },
          })
          retainScroll(element, store(key))
        }}
      >
        <Show when={ready()}>
          <p>rows</p>
        </Show>
      </div>
    ),
    host,
  )
  const unmount = () => {
    dispose()
    host.remove()
  }
  mounted.push(unmount)
  return { scroller: () => scroller, position: () => position, unmount }
}

const scrollTo = (element: HTMLElement, offset: number) => {
  element.scrollTop = offset
  element.dispatchEvent(new Event('scroll'))
}

it('comes back where the reader left it', async () => {
  const first = mount(() => 'files')
  await settle()
  scrollTo(first.scroller(), 240)
  first.unmount()

  const again = mount(() => 'files')
  await vi.waitFor(() => expect(again.position()).toBe(240))
})

it('waits for rows that arrive after the scroller does', async () => {
  offsets.set('files', 240)
  const [ready, setReady] = createSignal(false)
  const view = mount(() => 'files', ready)
  await settle()
  expect(view.position()).toBe(0)
  setReady(true)
  await vi.waitFor(() => expect(view.position()).toBe(240))
})

it('stops restoring once the reader scrolls for themselves', async () => {
  offsets.set('files', 240)
  const [ready, setReady] = createSignal(false)
  const view = mount(() => 'files', ready)
  await settle()
  view.scroller().dispatchEvent(new Event('wheel'))
  setReady(true)
  await settle()
  expect(view.position()).toBe(0)
})

it('keeps one place per key in a scroller that stays mounted', async () => {
  offsets.set('task-b', 90)
  const [task, setTask] = createSignal('task-a')
  const view = mount(task)
  await settle()
  scrollTo(view.scroller(), 300)
  setTask('task-b')
  await vi.waitFor(() => expect(view.position()).toBe(90))
  setTask('task-a')
  await vi.waitFor(() => expect(view.position()).toBe(300))
})
