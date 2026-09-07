import { render } from 'solid-js/web'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { prefsKey } from '@acorn/protocol/api.ts'
import { _resetNotices, pushNotice } from './notifications'

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
let host: HTMLElement
let dispose: (() => void) | undefined

beforeEach(() => {
  drawn.length = 0
  ;(window as { acorn?: unknown }).acorn = {
    notify: { show: async () => true, onActivate: () => () => {}, setBadge: (count: number | null) => drawn.push(count) },
  }
  host = document.createElement('div')
  document.body.append(host)
})
afterEach(() => {
  dispose?.()
  dispose = undefined
  host.remove()
  _resetNotices()
  delete (window as { acorn?: unknown }).acorn
})

const mount = (): void => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  qc.setQueryData(prefsKey, {})
  dispose = render(() => (
    <QueryClientProvider client={qc}>
      <NotificationBell onSelectTask={() => {}} />
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
