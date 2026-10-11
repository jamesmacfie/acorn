import { createQuery } from '@tanstack/solid-query'
import { WORKSPACES_PREF_KEY, workspacesMode, type WorkspacesMode } from '@acorn/protocol/workspacesMode.ts'
import { prefsOptions, projectsOptions } from '../../infra/queries'

/** Undefined until both active Node reads settle; controls that write membership wait for it. */
export function createWorkspacesMode(): () => WorkspacesMode | undefined {
  const prefs = createQuery(() => prefsOptions(true))
  const projects = createQuery(() => projectsOptions(true))
  return () =>
    prefs.data && projects.data ? workspacesMode(prefs.data[WORKSPACES_PREF_KEY], projects.data.length) : undefined
}
