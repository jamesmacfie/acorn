import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The page is six lines of wiring, and the one that can silently go wrong is the write: a checkbox
// has to save the merged blob, not the single field it owns, or turning the sound off would turn
// every other switch back on.
const mocks = vi.hoisted(() => ({ prefs: { data: {} as Record<string, string> }, saveJsonPref: vi.fn() }))
vi.mock('@tanstack/solid-query', () => ({
  createQuery: () => mocks.prefs,
  useQueryClient: () => ({}),
}))
vi.mock('../../infra/queries', () => ({ prefsOptions: () => ({}) }))
vi.mock('./savePref', () => ({ saveJsonPref: mocks.saveJsonPref }))
vi.mock('../notifications/deliver', () => ({ defaultDeliveryContext: {}, deliverNotice: vi.fn() }))
vi.mock('../tasks/tasks', () => ({ activeTaskId: () => 't1' }))

import NotificationSettings from './NotificationSettings'
import { deliverNotice } from '../notifications/deliver'

let host: HTMLElement
let dispose: () => void

const mount = () => {
  dispose?.()
  dispose = render(() => <NotificationSettings />, host)
}

beforeEach(() => {
  mocks.prefs.data = {}
  mocks.saveJsonPref.mockClear()
  vi.mocked(deliverNotice).mockClear()
  host = document.createElement('div')
  document.body.append(host)
  mount()
})

afterEach(() => {
  dispose()
  host.remove()
})

const boxes = () => [...host.querySelectorAll<HTMLInputElement>('input[type=checkbox]')]
const box = (label: string) => boxes().find((el) => el.closest('label')?.textContent?.includes(label))!

const toggle = (label: string) => {
  const el = box(label)
  el.checked = !el.checked
  el.dispatchEvent(new Event('change', { bubbles: true }))
}

describe('Settings → Notifications', () => {
  it('starts with every switch on when nothing is stored', () => {
    expect(boxes()).toHaveLength(5)
    expect(boxes().every((el) => el.checked)).toBe(true)
  })

  it('saves the whole blob when one switch moves', () => {
    toggle('Play a sound')
    expect(mocks.saveJsonPref).toHaveBeenCalledWith(expect.anything(), 'notifications', {
      sound: false, system: true, badge: true,
      events: { blocked: true, finished: true, error: true },
    })
  })

  it('keeps the other events when one event switch moves', () => {
    mocks.prefs.data = { notifications: '{"system":false}' }
    mount()
    toggle('An agent finishes')
    expect(mocks.saveJsonPref).toHaveBeenCalledWith(expect.anything(), 'notifications', {
      sound: true, system: false, badge: true,
      events: { blocked: true, finished: false, error: true },
    })
  })

  it('sends the test notification as one nobody watched', () => {
    host.querySelector('button')!.click()
    expect(deliverNotice).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'agent-needs-input', title: 'Test agent needs you', taskId: 't1' }),
      expect.objectContaining({ focused: expect.any(Function) }),
    )
    expect(vi.mocked(deliverNotice).mock.calls[0]![1]!.focused()).toBe(false)
  })
})
