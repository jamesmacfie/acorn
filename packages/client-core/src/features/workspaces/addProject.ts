import type { QueryClient } from '@tanstack/solid-query'
import { projectsKey, workspacesKey, type Workspace } from '../../infra/queries'
import { canPickFolder, pickFolder } from '../../infra/platform'
import { activeNodeId } from '../../infra/node/activeNode'
import { nodes } from '../../infra/node/fleet'
import { toast } from '../notifications/toast'
import { createProject } from './workspaceMutations'

/** The native picker selects a path on the desktop's machine. */
export const canAddProjectFromFolder = (): boolean =>
  canPickFolder() && nodes().some((node) => node.nodeId === activeNodeId() && node.local)

/** Registers a folder in `workspaceId`, or reports the workspace that already owns it. */
export async function addProjectFromFolder(queryClient: QueryClient, workspaceId: string | undefined): Promise<void> {
  try {
    if (!canAddProjectFromFolder()) throw new Error('Choose the local Node to add a folder.')
    const nodeId = activeNodeId()
    const path = await pickFolder()
    if (!path) return
    if (activeNodeId() !== nodeId) throw new Error('The active Node changed. Choose the folder again.')
    const { project } = await createProject({ path, ...(workspaceId ? { workspaceId } : {}) })
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: projectsKey }),
      queryClient.invalidateQueries({ queryKey: workspacesKey }),
    ])
    if (workspaceId && project.workspaceId !== workspaceId) {
      const workspace = queryClient.getQueryData<Workspace[]>(workspacesKey)?.find((entry) => entry.id === project.workspaceId)
      toast(`${project.name} is already in ${workspace?.name ?? 'another workspace'}. Move it in Settings → Overview.`)
    } else {
      toast(`Added ${project.name}.`, { tone: 'success' })
    }
  } catch (cause) {
    toast(cause instanceof Error ? cause.message : "Couldn't add the folder.", { tone: 'danger' })
  }
}
