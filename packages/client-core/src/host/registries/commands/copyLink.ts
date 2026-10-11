import { toast } from '../../../features/notifications/toast'
import type { Task } from '../../../infra/queries'
import { paneRegistry } from '../panes/panes'
import { projectSurfaceRoutes } from '../panes/projectSurfaces'
import { matchRoute, sourceIdForPath, sourceRegistry } from '../sources/sources'
import { buildLink, type Place } from './addresses'

type CopyablePlace = Extract<Place, { kind: 'task' | 'project' | 'settings' | 'source' }>

/** Only a registered focused pane can name an item. Selection belongs to the pane that reports it. */
export function taskPlace(task: Task, focusedPaneId?: string): Extract<Place, { kind: 'task' }> {
  const pane = focusedPaneId ? paneRegistry.get(focusedPaneId) : undefined
  if (!pane) return { kind: 'task', taskId: task.id }
  try {
    const item = pane.selectedItem?.(task)
    return { kind: 'task', taskId: task.id, pane: pane.id, ...(item ? { item } : {}) }
  } catch {
    return { kind: 'task', taskId: task.id, pane: pane.id }
  }
}

/** The route is already encoded. Decode each component once before handing it to buildLink. */
export function projectPlaceFromPath(pathname: string): Extract<Place, { kind: 'project' }> | null {
  const parts = pathname.split('/')
  if (parts[0] !== '' || parts[1] !== 'p' || !parts[2]) return null
  try {
    const [projectId, ...rest] = parts.slice(2).map(decodeURIComponent)
    return projectId && rest.every(Boolean) ? { kind: 'project', projectId, rest } : null
  } catch {
    return null
  }
}

/** A project subpath can belong to a loaded surface even when its rail source is not project-scoped. */
export function sourcePlaceFromPath(
  pathname: string,
  sourceId: string,
  projectScoped: boolean,
): Extract<Place, { kind: 'project' | 'source' }> {
  const project = projectPlaceFromPath(pathname)
  const routeOwned = project?.rest.length
    ? sourceIdForPath(pathname) === sourceId ||
      projectSurfaceRoutes().some(
        (surface) =>
          sourceRegistry.get(sourceId)?.projectSurfaceId === surface.id && !!matchRoute(surface.path, pathname),
      )
    : false
  return project && (project.rest.length === 0 ? projectScoped : routeOwned) ? project : { kind: 'source', sourceId }
}

/** Only a successful clipboard write earns the confirmation. */
export async function copyLink(nodeId: string | null | undefined, place: CopyablePlace): Promise<void> {
  try {
    if (!nodeId) throw new Error('No active Node')
    const href = buildLink(nodeId, place)
    await navigator.clipboard.writeText(href)
    toast('Link copied', { tone: 'success' })
  } catch (error) {
    toast(`Could not copy link: ${error instanceof Error ? error.message : String(error)}`, { tone: 'danger' })
  }
}
