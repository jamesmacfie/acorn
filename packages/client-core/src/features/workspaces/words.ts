import type { WorkspacesMode } from '@acorn/protocol/workspacesMode.ts'
import { createWorkspacesMode } from './workspacesMode'

export type WorkspaceWords = {
  readonly singular: 'project' | 'workspace'
  readonly plural: 'projects' | 'workspaces'
  readonly capitalized: 'Project' | 'Workspace'
  readonly capitalizedPlural: 'Projects' | 'Workspaces'
}

const PROJECT_WORDS: WorkspaceWords = Object.freeze({
  singular: 'project',
  plural: 'projects',
  capitalized: 'Project',
  capitalizedPlural: 'Projects',
})
const WORKSPACE_WORDS: WorkspaceWords = Object.freeze({
  singular: 'workspace',
  plural: 'workspaces',
  capitalized: 'Workspace',
  capitalizedPlural: 'Workspaces',
})

/** Use the active Node's mode at read time, so a fleet switch cannot retain another Node's label. */
export const workspaceWords = (mode: WorkspacesMode | undefined): WorkspaceWords =>
  mode === 'off' ? PROJECT_WORDS : WORKSPACE_WORDS

/** Reactive words for client components and first-party plugins. */
export function createWorkspaceWords(): () => WorkspaceWords {
  const mode = createWorkspacesMode()
  return () => workspaceWords(mode())
}
