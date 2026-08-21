import { createEffect, onCleanup, type Accessor, type Setter } from 'solid-js'
import type { QueryClient } from '@tanstack/solid-query'
import type { NavigateOptions } from '@solidjs/router'
import type { Task } from '@acorn/protocol/api.ts'
import type { Project } from '../queries'
import { selectedSource, setActiveTaskId, setSelectedSource, activeTaskId } from '../tasks/tasks'
import { defaultSourceId } from '../registries/sources'
import { isProjectPath, projectIdFromPath, projectPath } from '../registries/corePaths'
// Also the module that seeds the built-in twelve into the theme registry, which is what makes
// `resolveTheme` able to answer at all before Settings → Appearance has ever been opened.
import { resolveTheme } from '../settings/themes'
import { PrefKeys } from './prefKeys'
import { appStateBinding, persistedStateRegistry, type PersistedStateSlice } from './persistedState'
import { createStartupRestore } from './startupRestore'

type Navigate = (to: string, options?: Partial<NavigateOptions>) => void

const stringCodec = {
  parse: (raw: unknown): string => typeof raw === 'string' ? raw : '',
  serialize: (value: string): unknown => value,
}

const legacyScalar = (key: string) => (prefs: Readonly<Record<string, string>>) => ({ '': prefs[key] ?? '' })

// Every read goes through `resolveTheme` (settings/themes.ts), which falls back to the built-in
// default when the stored id names a theme that is not registered right now: a plugin theme whose
// package is disabled, gone, or on a node this window cannot reach. It reads the theme registry, so
// this function is reactive: the effect below re-runs and the plugin's theme reappears the moment the
// chrome pass registers it. The stored pref is never rewritten.
function applyTheme(prefs: Readonly<Record<string, string>>): () => void {
  const follow = (prefs[PrefKeys.themeFollowSystem] ?? (prefs[PrefKeys.theme] ? 'false' : 'true')) === 'true'
  if (!follow) {
    document.documentElement.dataset.theme = resolveTheme(prefs[PrefKeys.theme], 'light')
    return () => {}
  }
  const light = resolveTheme(prefs[PrefKeys.themeLight], 'light')
  const dark = resolveTheme(prefs[PrefKeys.themeDark], 'dark')
  const media = matchMedia('(prefers-color-scheme: dark)')
  const update = () => {
    document.documentElement.dataset.theme = media.matches ? dark : light
  }
  update()
  media.addEventListener('change', update)
  return () => media.removeEventListener('change', update)
}

// Visual style (shape/typography/space/density) is the second appearance axis, orthogonal to theme
// (colour). No disposer and no media listener: unlike light/dark there is no OS signal to follow.
// 'terminal' is the attribute-less :root default, so this only ever writes a non-default pack.
function applyStyle(prefs: Readonly<Record<string, string>>): void {
  document.documentElement.dataset.style = prefs[PrefKeys.style] ?? 'terminal'
}

export type AppStartupOptions = {
  queryClient: QueryClient
  prefs: Accessor<Readonly<Record<string, string>> | undefined>
  cacheRestoring: Accessor<boolean>
  projects: Accessor<Project[] | undefined>
  tasks: Accessor<Task[] | undefined>
  // The current location's pathname. Read whole rather than rebuilt from route params: this slice
  // used to assemble `/p/:projectId/pulls/:number` by hand, which meant core was writing one
  // plugin's URL shape and could remember no other. Any project-scoped path a source contributes
  // now round-trips unchanged.
  path: Accessor<string>
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
    applyStyle(prefs)
  })
  onCleanup(() => disposeTheme())

  const shellSlices: PersistedStateSlice<unknown>[] = [
    {
      id: 'core.last-path', key: PrefKeys.lastPath, scope: 'app', restore: 'workspace', version: 1,
      codec: stringCodec, empty: () => '', unknownIds: 'drop', maxBytes: 2 * 1024,
      binding: appStateBinding(
        // Only project-scoped paths are worth remembering: a task path is restored by
        // `core.last-task` and a settings path is not a place to come back to.
        () => (isProjectPath(options.path()) ? options.path() : ''),
        (saved) => {
          const projects = options.projects() ?? []
          if (!projects.length || isProjectPath(options.path())) return
          const savedProjectId = projectIdFromPath(saved)
          const valid = !!savedProjectId && projects.some((project) => project.id === savedProjectId)
          const fallback = projects.find((project) => !project.hidden) ?? projects[0]
          options.navigate(valid ? saved : projectPath(fallback.id), { replace: true })
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
      codec: stringCodec, empty: () => defaultSourceId() ?? '', unknownIds: 'retain-inert', maxBytes: 512,
      binding: appStateBinding(
        () => selectedSource() ?? '',
        (saved) => {
          // Home is the core-owned default. A saved optional source is restored here and App.tsx
          // corrects it after integrations/plugin contributions are known if that source is disabled.
          setSelectedSource(saved || defaultSourceId() || null)
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
    ready: () => !options.cacheRestoring() && options.projects() !== undefined && options.tasks() !== undefined,
    slices: () => [...persistedStateRegistry.entries(), ...shellSlices],
  })
}
