import { render } from 'solid-js/web'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { prefsKey } from '@acorn/protocol/api.ts'
import { _resetNotices, pushNotice, registerNoticeTargetHandler } from './notifications'

// The bell and the app icon draw one number, so clearing the bell clears the icon
// (docs/notifications.md § The channels). badge.ts owns the effect; what this asserts is the wiring
// around it, because the pill, the ring and the popover only meet in the component.
//
// The popover is opened rather than reached into: "Mark all read" is only in the DOM while it is
// open, so a test that called `markAllRead` would not have covered the button.
vi.mock('@solidjs/router', () => ({
  useNavigate: () => () => {},
  useParams: () => ({}),
  A: (props: { children?: unknown }) => props.children,
}))

const { default: NotificationBell } = await import('./NotificationBell')

const drawn: (number | null)[] = []
const selectedTasks: string[] = []
const openedSessions: string[] = []
let activateNotice: ((tag: string) => void) | undefined
let releaseTarget: (() => void) | undefined
let host: HTMLElement
let dispose: (() => void) | undefined

beforeEach(() => {
  drawn.length = 0
  selectedTasks.length = 0
  openedSessions.length = 0
  activateNotice = undefined
  releaseTarget = registerNoticeTargetHandler('managed-agent', (_taskId, target) => openedSessions.push(target.resourceId))
  ;(window as { acorn?: unknown }).acorn = {
    notify: {
      show: async () => true,
      onActivate: (callback: (tag: string) => void) => {
        activateNotice = callback
        return () => { activateNotice = undefined }
      },
      setBadge: (count: number | null) => drawn.push(count),
    },
  }
  host = document.createElement('div')
  document.body.append(host)
})
afterEach(() => {
  dispose?.()
  dispose = undefined
  releaseTarget?.()
  host.remove()
  _resetNotices()
  delete (window as { acorn?: unknown }).acorn
})

const mount = (): void => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  qc.setQueryData(prefsKey, {})
  dispose = render(() => (
    <QueryClientProvider client={qc}>
      <NotificationBell onSelectTask={(taskId) => selectedTasks.push(taskId)} />
    </QueryClientProvider>
  ), host)
}

const button = (text: string): HTMLElement => {
  // The document, not the host: the popover portals its content out of the trigger's subtree.
  const found = [...document.querySelectorAll('button')].find(
    (el) => el.textContent?.includes(text) || el.getAttribute('aria-label') === text,
  )
  if (!found) throw new Error(`no button named ${text}`)
  return found
}

it('puts the unread count on the app icon and takes it off again', () => {
  mount()
  pushNotice({ taskId: 't1', kind: 'agent-completed', title: 'claude finished', at: 1 })
  pushNotice({ taskId: 't2', kind: 'agent-error', title: 'claude failed', at: 2 })
  expect(drawn.at(-1)).toBe(2)

  button('Notifications').click()
  button('Mark all read').click()
  expect(drawn.at(-1)).toBe(null)
})

it('keeps the current view when completion notices arrive and the window gains focus', () => {
  mount()
  pushNotice({ taskId: 't1', kind: 'agent-completed', title: 'First finished', at: 1, target: { kind: 'managed-agent', resourceId: 's1' } })
  pushNotice({ taskId: 't2', kind: 'agent-completed', title: 'Second finished', at: 2, target: { kind: 'managed-agent', resourceId: 's2' } })
  window.dispatchEvent(new Event('focus'))
  expect(selectedTasks).toEqual([])
  expect(openedSessions).toEqual([])
})

it('opens the clicked banner’s session even when another notice arrived later', () => {
  mount()
  const earlier = pushNotice({ taskId: 't1', kind: 'agent-completed', title: 'First finished', at: 1, target: { kind: 'managed-agent', resourceId: 's1' } })
  pushNotice({ taskId: 't2', kind: 'agent-completed', title: 'Second finished', at: 2, target: { kind: 'managed-agent', resourceId: 's2' } })
  expect(activateNotice).toBeDefined()
  activateNotice!(earlier.id)
  expect(selectedTasks).toEqual(['t1'])
  expect(openedSessions).toEqual(['s1'])
})

it('opens a session when its row in the bell is clicked', () => {
  mount()
  pushNotice({ taskId: 't1', kind: 'agent-completed', title: 'First finished', at: 1, target: { kind: 'managed-agent', resourceId: 's1' } })
  button('Notifications').click()
  button('First finished').click()
  expect(selectedTasks).toEqual(['t1'])
  expect(openedSessions).toEqual(['s1'])
})
