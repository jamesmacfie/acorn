export const WORKSPACES_PREF_KEY = 'core.workspaces'

export type WorkspacesMode = 'on' | 'off'

/** Existing project data keeps grouped behavior when the preference has not been settled. */
export function workspacesMode(value: string | null | undefined, projectCount: number): WorkspacesMode {
  return value === 'on' || value === 'off' ? value : projectCount > 0 ? 'on' : 'off'
}
