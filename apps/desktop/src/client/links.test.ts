import { afterEach, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({
  pending: [] as string[],
  wake: undefined as (() => void) | undefined,
  onSubscribe: undefined as (() => void) | undefined,
  takePending: vi.fn(async () => native.pending.splice(0)),
  subscribe: vi.fn(async (wake: () => void) => {
    native.wake = wake
    native.onSubscribe?.()
    return () => { native.wake = undefined }
  }),
}))
const dispatch = vi.hoisted(() => ({
  open: vi.fn<(href: string) => Promise<{ kind: string }>>(async () => ({ kind: 'opened' })),
  refusals: [] as string[],
  listeners: new Set<(payload: { href: string }) => void>(),
}))
vi.mock('@acorn/client-core/infra/platform', () => ({
  desktopLinks: () => ({ subscribe: native.subscribe, takePending: native.takePending }),
}))
vi.mock('@acorn/client-core/infra/telemetry', () => ({ createLogger: () => ({ error: vi.fn() }) }))
vi.mock('@acorn/client-core/host/registries/commands', () => ({
  clientEvents: {
    on: (_kind: string, listener: (payload: { href: string }) => void) => {
      dispatch.listeners.add(listener)
      return () => { dispatch.listeners.delete(listener) }
    },
  },
  openLink: (href: string) => dispatch.open(href),
  reportLinkFailure: (href: string, reason: string) => {
    dispatch.refusals.push(`${reason}: ${href}`)
    return { kind: 'refused', reason, link: href }
  },
}))

import { startDesktopLinks } from './links'

const receive = (href: string) => { native.pending.push(href); native.wake?.() }
const click = (href: string) => {
  for (const listener of dispatch.listeners) listener({ href })
}

afterEach(() => {
  vi.unstubAllGlobals()
  native.pending = []
  native.wake = undefined
  native.onSubscribe = undefined
  native.takePending.mockClear()
  native.subscribe.mockClear()
  dispatch.open.mockReset()
  dispatch.open.mockResolvedValue({ kind: 'opened' })
  dispatch.refusals = []
  dispatch.listeners.clear()
})

it('drains pre-subscription links once, retains order through a remount wait, and reports click failures', async () => {
  vi.stubGlobal('window', new EventTarget())
  native.pending.push('acorn://node-a/settings/one', 'acorn://node-a/settings/two')
  native.onSubscribe = () => receive('acorn://node-a/settings/three')
  const stop = await startDesktopLinks()
  expect(dispatch.open.mock.calls.map(([href]) => href)).toEqual([
    'acorn://node-a/settings/one', 'acorn://node-a/settings/two', 'acorn://node-a/settings/three',
  ])

  receive('acorn://node-a/settings/four')
  receive('acorn://node-a/settings/five')
  native.wake?.()
  await vi.waitFor(() => expect(dispatch.open).toHaveBeenCalledTimes(5))
  expect(dispatch.open.mock.calls.map(([href]) => href).slice(3)).toEqual([
    'acorn://node-a/settings/four', 'acorn://node-a/settings/five',
  ])

  let finishRemount!: () => void
  dispatch.open.mockImplementation(async (href) => {
    if (href.endsWith('/project')) await new Promise<void>((resolve) => { finishRemount = resolve })
    if (href.endsWith('/broken')) throw new Error('dispatch failed')
    return { kind: 'opened' }
  })
  receive('acorn://node-b/p/project')
  receive('acorn://node-b/settings/after')
  await vi.waitFor(() => expect(finishRemount).toBeTypeOf('function'))
  expect(dispatch.open.mock.calls.map(([href]) => href)).not.toContain('acorn://node-b/settings/after')
  finishRemount()
  await vi.waitFor(() => expect(dispatch.open.mock.calls.at(-1)?.[0]).toBe('acorn://node-b/settings/after'))

  click('acorn://node-b/settings/broken')
  await vi.waitFor(() => expect(dispatch.refusals).toEqual([
    'dispatch failed: acorn://node-b/settings/broken',
  ]))
  stop()
  expect(native.wake).toBeUndefined()
  expect(dispatch.listeners.size).toBe(0)
})
