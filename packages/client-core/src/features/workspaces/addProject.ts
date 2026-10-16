import type { QueryClient } from '@tanstack/solid-query'
import { projectsKey, workspacesKey, type Project, type Workspace } from '../../infra/queries'
import { canPickFolder, pickFolder } from '../../infra/platform'
import { activeNodeId } from '../../infra/node/activeNode'
import { nodes } from '../../infra/node/fleet'
import { toast } from '../notifications/toast'
import { createProject } from './workspaceMutations'
import type { WorkspacesMode } from '@acorn/protocol/workspacesMode.ts'

/** The native picker selects a path on the desktop's machine, so it can only choose a folder for the
 *  local Node. */
export const canPickNodeFolder = (nodeId: string | null): boolean =>
  canPickFolder() && nodes().some((node) => node.nodeId === nodeId && node.local)

/** Every folder a Node will read is picked here, so no path from this client's disk reaches a remote
 *  Node. Resolves null when `nodeId` isn't local, when there's no picker, and when the owner cancels.
 *  `pickFolder()` is for paths this device reads itself. */
export const pickNodeFolder = async (nodeId: string | null): Promise<string | null> =>
  canPickNodeFolder(nodeId) ? pickFolder() : null

export const canAddProjectFromFolder = (): boolean => canPickNodeFolder(activeNodeId())

/** Registers a folder in the active Node's mode; grouped mode may assign its workspace. */
export async function addProjectFromFolder(
  queryClient: QueryClient,
  mode: WorkspacesMode,
  workspaceId?: string,
): Promise<void> {
  try {
    if (!canAddProjectFromFolder()) throw new Error('Choose the local Node to add a folder.')
    const nodeId = activeNodeId()
    const path = await pickNodeFolder(nodeId)
    if (!path) return
    if (activeNodeId() !== nodeId) throw new Error('The active Node changed. Choose the folder again.')
    const knownProjectIds = new Set(
      queryClient.getQueryData<Project[]>(projectsKey)?.map((project) => project.id) ?? [],
    )
    const { project } = await createProject({ path, ...(mode === 'on' && workspaceId ? { workspaceId } : {}) })
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: projectsKey }),
      queryClient.invalidateQueries({ queryKey: workspacesKey }),
    ])
    if (mode === 'off') {
      const alreadyAdded = knownProjectIds.has(project.id)
      toast(alreadyAdded ? `${project.name} is already added.` : `Added ${project.name}.`, {
        tone: alreadyAdded ? 'neutral' : 'success',
      })
    } else if (workspaceId && project.workspaceId !== workspaceId) {
      const workspace = queryClient
        .getQueryData<Workspace[]>(workspacesKey)
        ?.find((entry) => entry.id === project.workspaceId)
      toast(`${project.name} is already in ${workspace?.name ?? 'another workspace'}. Move it in Settings → Overview.`)
    } else {
      toast(`Added ${project.name}.`, { tone: 'success' })
    }
  } catch (cause) {
    toast(cause instanceof Error ? cause.message : "Couldn't add the folder.", { tone: 'danger' })
  }
}
