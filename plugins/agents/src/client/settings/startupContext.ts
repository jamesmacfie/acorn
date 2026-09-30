import type { QueryClient } from '@tanstack/solid-query'
import { PrefKeys, savePref } from '@acorn/plugin-api/client'

// Whether a harness CLI started in the terminal drawer is sent the task's pull request, linked issues
// and notes when it first goes idle. One reader and one writer, so the page and anything that writes
// the value later share one persistence path.
//
// The preference is core's (`PrefKeys.startupContextInjection`), and the memory plugin's launch-context
// handler is what reads it on the node, through `core.context.injectionEnabled`. The terminal plugin
// only delivers what that handler returns. So the switch sits with the other things a session starts
// with, and it reaches the value through the plugin API like any other page, rather than through
// another plugin's code.

/** The prefs map as `prefsOptions` hands it over: absent while the first read is in flight. */
type Prefs = Record<string, string> | undefined

// Opt-out: absent means on, matching `contextInjectionEnabled` in
// packages/node-core/src/server/worktrees/taskWorktree.ts.
export const startupContextInjection = (prefs: Prefs): boolean =>
  (prefs?.[PrefKeys.startupContextInjection] ?? 'true') !== 'false'
export const saveStartupContextInjection = (qc: QueryClient, on: boolean): Promise<boolean> =>
  savePref(qc, PrefKeys.startupContextInjection, on ? 'true' : 'false')
