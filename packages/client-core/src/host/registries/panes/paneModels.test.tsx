import { createRoot, onCleanup } from 'solid-js'
import { render } from 'solid-js/web'
import { QueryClient, QueryClientProvider, createQuery } from '@tanstack/solid-query'
import { afterEach, expect, it } from 'vitest'
import { PaneModelHost } from './PaneModelHost'
import {
  DEFAULT_KEPT_TASKS,
  _resetPaneModels,
  acquirePaneModelHost,
  keptTasks,
  markPaneDrawn,
  paneDrawn,
  paneModel,
} from './paneModels'
import { evictScope } from '../shell/scopeEviction'
import { writeDevicePref } from '../../../infra/persistence/devicePrefs'
import { PrefKeys } from '../../../infra/persistence/prefKeys'

afterEach(() => {
  _resetPaneModels()
  localStorage.clear()
})

it('keeps as many tasks per pane as the device setting says, and reads anything else as the default', () => {
  expect(keptTasks({ [PrefKeys.keptTasks]: '7' })).toBe(DEFAULT_KEPT_TASKS)
  writeDevicePref(PrefKeys.keptTasks, '1')
  const lease = acquirePaneModelHost('a')
  const disposed: string[] = []
  const build = (id: string) => () => {
    onCleanup(() => disposed.push(id))
    return id
  }
  paneModel('notes', 't1', build('notes t1'), 'notes', lease.scope)
  paneModel('editor', 't1', build('editor t1'), 'editor', lease.scope)
  paneModel('notes', 't2', build('notes t2'), 'notes', lease.scope)
  // Each pane counts its own tasks.
  expect(disposed).toEqual(['notes t1'])
  lease.release()
})

it('retires the captured generation without clearing an equal-ID replacement or its drawn mark', () => {
  const old = acquirePaneModelHost('a')
  let retired = 0
  paneModel(
    'notes',
    'same',
    () => {
      onCleanup(() => retired++)
      return {}
    },
    'notes',
    old.scope,
  )
  const releaseOldMark = markPaneDrawn('notes', 'same', old.scope)
  evictScope({ scope: 'node-switched', from: 'a', to: 'b' })
  const current = acquirePaneModelHost('a')
  const model = paneModel('notes', 'same', () => ({ fresh: true }), 'notes', current.scope)
  const releaseCurrentMark = markPaneDrawn('notes', 'same', current.scope)
  old.release()
  old.release()
  releaseOldMark()
  releaseOldMark()
  expect(retired).toBe(1)
  expect(paneDrawn('notes', 'same', old.scope)).toBe(false)
  expect(paneDrawn('notes', 'same', current.scope)).toBe(true)
  expect(
    paneModel(
      'notes',
      'same',
      () => {
        throw Error('rebuilt')
      },
      'notes',
      current.scope,
    ),
  ).toBe(model)
  releaseCurrentMark()
  current.release()
})

it('disposes a partial failed construction and allows the same pane to retry', () => {
  const lease = acquirePaneModelHost('a')
  let cleanups = 0
  expect(() =>
    createRoot(() =>
      paneModel(
        'notes',
        'same',
        () => {
          onCleanup(() => cleanups++)
          throw Error('build failed')
        },
        'notes',
        lease.scope,
      ),
    ),
  ).toThrow('build failed')
  expect(cleanups).toBe(1)
  expect(paneModel('notes', 'same', () => 'retry', 'notes', lease.scope)).toBe('retry')
  lease.release()
})

it('shares a detached model across regions but retires its query observer with the provider host', () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['owner'], 'cached')
  const host = document.createElement('div')
  let built = 0
  const Region = () => {
    const model = paneModel('notes', 'same', () => {
      built++
      return createQuery(() => ({ queryKey: ['owner'], queryFn: async () => 'cached', staleTime: Infinity }))
    })
    return <span>{model.data}</span>
  }
  const stop = render(
    () => (
      <QueryClientProvider client={client}>
        <PaneModelHost nodeId="a">
          <Region />
          <Region />
        </PaneModelHost>
      </QueryClientProvider>
    ),
    host,
  )
  expect(built).toBe(1)
  expect(host.textContent).toBe('cachedcached')
  expect(
    client
      .getQueryCache()
      .find({ queryKey: ['owner'] })
      ?.getObserversCount(),
  ).toBe(1)
  stop()
  expect(
    client
      .getQueryCache()
      .find({ queryKey: ['owner'] })
      ?.getObserversCount(),
  ).toBe(0)
  client.clear()
})
