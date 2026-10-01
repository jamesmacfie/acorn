import { createEffect, createSignal, onCleanup, type Accessor } from 'solid-js'
import type { QueryClient } from '@tanstack/solid-query'
import type { Task, Workspace } from '@acorn/protocol/api.ts'
import type { Project } from '../queries'
// Also the module that seeds the built-in twelve into the theme registry, which is what makes
// `resolveTheme` able to answer at all before Settings → Appearance has ever been opened.
import { resolveTheme } from '../../features/settings/builtInThemes'
import { resolveStyle } from '../../features/settings/uiStyles'
import { PrefKeys } from './prefKeys'
import { persistedStateRegistry, type PersistedStateSlice } from './persistedState'
import { lastWorkspaceSlice, workspaceHistorySlice } from './stateSlices'
import { createStartupRestore } from './startupRestore'

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
  document.documentElement.dataset.style = resolveStyle(prefs[PrefKeys.style])
}

export type AppStartupOptions = {
  queryClient: QueryClient
  prefs: Accessor<Readonly<Record<string, string>> | undefined>
  // Whether `prefs` is the node's own answer from this launch, or the best there will be. The first
  // value is usually the persisted cache, which is written at most every five seconds, so a place
  // changed just before quitting came back as the one before it. The theme still paints from the
  // cache; only the restore waits.
  prefsSettled: Accessor<boolean>
  cacheRestoring: Accessor<boolean>
  projects: Accessor<Project[] | undefined>
  tasks: Accessor<Task[] | undefined>
  workspaces: Accessor<Workspace[] | undefined>
}

export function createAppStartupRestore(options: AppStartupOptions): { restored: Accessor<boolean>; lastWorkspaceId: Accessor<string> } {
  let disposeTheme = () => {}
  createEffect(() => {
    const prefs = options.prefs()
    if (!prefs) return
    disposeTheme()
    disposeTheme = applyTheme(prefs)
    applyStyle(prefs)
  })
  onCleanup(() => disposeTheme())

  // Held for App.tsx rather than acted on here. Opening a workspace can open a task, and a task opened
  // before the pane layouts land in the last phase gets a default layout that the saved one then
  // declines to overwrite.
  const [lastWorkspaceId, setLastWorkspaceId] = createSignal('')
  const shellSlices = [workspaceHistorySlice, lastWorkspaceSlice(setLastWorkspaceId)] as readonly PersistedStateSlice<unknown>[]

  const { restored } = createStartupRestore({
    queryClient: options.queryClient,
    prefs: options.prefs,
    ready: () => !options.cacheRestoring() && options.prefsSettled() && options.projects() !== undefined
      && options.tasks() !== undefined && options.workspaces() !== undefined,
    slices: () => [...persistedStateRegistry.entries(), ...shellSlices],
  })
  return { restored, lastWorkspaceId }
}
