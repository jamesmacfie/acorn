import type { QueryClient } from '@tanstack/solid-query'
import { projectsKey, workspacesKey } from '../../infra/queries'
import { pickFolder } from '../../infra/platform'
import { toast } from '../notifications/toast'
import { createProject } from './workspaceMutations'

/** Picks a folder and adds it as a project in `workspaceId`, or the node's default workspace. */
export async function addProjectFromFolder(queryClient: QueryClient, workspaceId: string | undefined): Promise<void> {
  const path = await pickFolder()
  if (!path) return
  try {
    const { project } = await createProject({ path, ...(workspaceId ? { workspaceId } : {}) })
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: projectsKey }),
      queryClient.invalidateQueries({ queryKey: workspacesKey }),
    ])
    toast(`Added ${project.name}.`, { tone: 'success' })
  } catch (cause) {
    toast(cause instanceof Error ? cause.message : "Couldn't add the folder.", { tone: 'danger' })
  }
}
