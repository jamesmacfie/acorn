import { createEffect, onCleanup, type Accessor, type Setter } from 'solid-js'
import type { QueryClient } from '@tanstack/solid-query'
import type { NavigateOptions } from '@solidjs/router'
import type { Repo, Task } from '../../shared/api'
import { selectedSource, setActiveTaskId, setSelectedSource, activeTaskId } from '../tasks/tasks'
import { PrefKeys } from './prefKeys'
import { appStateBinding, persistedStateRegistry, type PersistedStateSlice } from './persistedState'
import { createStartupRestore } from './startupRestore'

type Params = { owner?: string; repo?: string; number?: string }
type Navigate = (to: string, options?: Partial<NavigateOptions>) => void

const stringCodec = {
  parse: (raw: unknown): string => typeof raw === 'string' ? raw : '',
  serialize: (value: string): unknown => value,
}

const legacyScalar = (key: string) => (prefs: Readonly<Record<string, string>>) => ({ '': prefs[key] ?? '' })

function applyTheme(prefs: Readonly<Record<string, string>>): () => void {
  const follow = (prefs[PrefKeys.themeFollowSystem] ?? (prefs[PrefKeys.theme] ? 'false' : 'true')) === 'true'
  if (!follow) {
    document.documentElement.dataset.theme = prefs[PrefKeys.theme] ?? 'light'
    return () => {}
  }
  const light = prefs[PrefKeys.themeLight] ?? 'light'
  const dark = prefs[PrefKeys.themeDark] ?? 'dark'
  const media = matchMedia('(prefers-color-scheme: dark)')
  const update = () => {
    document.documentElement.dataset.theme = media.matches ? dark : light
  }
  update()
  media.addEventListener('change', update)
  return () => media.removeEventListener('change', update)
}

export type AppStartupOptions = {
  queryClient: QueryClient
  prefs: Accessor<Readonly<Record<string, string>> | undefined>
  cacheRestoring: Accessor<boolean>
  repos: Accessor<Repo[] | undefined>
  tasks: Accessor<Task[] | undefined>
  params: Params
  navigate: Navigate
  collapsed: Accessor<boolean>
  setCollapsed: Setter<boolean>
}

export function createAppStartupRestore(options: AppStartupOptions): { restored: Accessor<boolean> } {
  let disposeTheme = () => {}
  createEffect(() => {
    const prefs = options.prefs()
    if (!prefs) return
    disposeTheme()
    disposeTheme = applyTheme(prefs)
  })
  onCleanup(() => disposeTheme())

  const shellSlices: PersistedStateSlice<unknown>[] = [
    {
      id: 'core.last-path', key: PrefKeys.lastPath, scope: 'app', restore: 'workspace', version: 1,
      codec: stringCodec, empty: () => '', unknownIds: 'drop', maxBytes: 2 * 1024,
      binding: appStateBinding(
        () => options.params.owner && options.params.repo
          ? `/${options.params.owner}/${options.params.repo}${options.params.number ? `/${options.params.number}` : ''}`
          : '',
        (saved) => {
          const repos = options.repos() ?? []
          if (!repos.length || options.params.owner) return
          const [, owner, repo] = saved.split('/')
          const valid = !!saved && repos.some((candidate) => candidate.owner === owner && candidate.name === repo)
          const fallback = repos[0]
          options.navigate(valid ? saved : `/${fallback.owner}/${fallback.name}`, { replace: true })
        },
      ),
      legacy: legacyScalar(PrefKeys.lastPath),
    },
    {
      id: 'core.last-task', key: PrefKeys.lastTask, scope: 'app', restore: 'view', version: 1,
      codec: stringCodec, empty: () => '', unknownIds: 'drop', maxBytes: 512,
      binding: appStateBinding(
        () => activeTaskId() ?? '',
        (saved) => {
          if (activeTaskId()) return
          const tasks = options.tasks() ?? []
          const task = tasks.find((candidate) => candidate.id === saved) ?? tasks[0]
          if (task) setActiveTaskId(task.id)
        },
      ),
      legacy: legacyScalar(PrefKeys.lastTask),
    },
    {
      id: 'core.last-source', key: PrefKeys.lastSource, scope: 'app', restore: 'view', version: 1,
      codec: stringCodec, empty: () => 'github', unknownIds: 'retain-inert', maxBytes: 512,
      binding: appStateBinding(
        () => selectedSource() ?? '',
        (saved) => {
          setSelectedSource(saved || null)
        },
      ),
      legacy: legacyScalar(PrefKeys.lastSource),
    },
    {
      id: 'core.left-collapsed', key: PrefKeys.leftCollapsed, scope: 'app', restore: 'workspace', version: 1,
      codec: {
        parse: (raw) => raw === '1',
        serialize: (value: boolean) => value ? '1' : '0',
      },
      empty: () => false, unknownIds: 'drop', maxBytes: 1,
      binding: appStateBinding(options.collapsed, options.setCollapsed),
      legacy: (prefs) => ({ '': prefs[PrefKeys.leftCollapsed] ?? '0' }),
    } as PersistedStateSlice<unknown>,
  ]

  return createStartupRestore({
    queryClient: options.queryClient,
    prefs: options.prefs,
    ready: () => !options.cacheRestoring() && options.repos() !== undefined && options.tasks() !== undefined,
    slices: () => [...persistedStateRegistry.entries(), ...shellSlices],
  })
}
