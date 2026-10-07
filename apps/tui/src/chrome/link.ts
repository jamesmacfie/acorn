import { batch } from 'solid-js'
import { setActiveItem } from '@acorn/client-core/kit/keys'
import type { Address } from '@acorn/client-core/host/registries/commands/addresses'
import { openPane, projectPath, TASK_ROUTE } from '@acorn/client-core/host/registries/commands'
import { activateTaskSignals } from '@acorn/client-core/features/tasks/activate.ts'
import { setActiveTaskId, setSelectedSource } from '@acorn/client-core/features/tasks/tasks.ts'
import { inAppPathFor, parseInAppTarget, projectSurfaceRoutes } from '@acorn/client-core/host/registries/panes'
import { paneAvailable, paneContribution } from '@acorn/client-core/host/registries/panes/panes.ts'
import { matchRoute, sourceIdForPath } from '@acorn/client-core/host/registries/sources'
import { sourceRegistry } from '@acorn/client-core/host/registries/sources'
import { toast } from '@acorn/client-core/features/notifications'
import { useNavigate } from '../kit/router'
import { showPane } from './panes'
import { sourceCollectionId } from './Rail'
import { itemByIdentity } from '../keys/collectionRegistry'
import { focusRenderable } from '../keys/regions'
import { openSettings, placeFor } from './settingsStore'
import type { ShellModel } from './model'

/** Resolve a startup address against the roster this terminal can actually draw. */
export function openTerminalLink(address: Address, model: ShellModel): void {
  const navigate = useNavigate()
  const refuse = (reason: string): void => toast(reason, { tone: 'danger' })
  const selectLinkedSource = (sourceId: string, workspaceId: string): void => {
    // The focused Menu row otherwise picks its old source during focus settling.
    setActiveItem(sourceCollectionId(workspaceId), sourceId)
    setSelectedSource(sourceId)
    focusRenderable(itemByIdentity(`${sourceCollectionId(workspaceId)}\u0000${sourceId}`))
  }
  const openProjectPath = (path: string, projectId: string): void => {
    const owner = model.workspaces().find((workspace) => workspace.projects.some((project) => project.id === projectId))
    if (!owner) return refuse(`No project ${projectId} on this node.`)
    const base = projectPath(projectId)
    const surface = projectSurfaceRoutes().find((entry) => matchRoute(entry.path, path))
    const surfaceSource = surface && sourceRegistry.entries().find((entry) => entry.projectSurfaceId === surface.id)?.id
    const sourceId = sourceIdForPath(path) ?? surfaceSource
    const source = sourceId ? sourceRegistry.get(sourceId) : undefined
    const sourceVisible = model.workspace()?.id !== owner.id || model.sources().some((entry) => entry.id === sourceId)
    const unavailable = path !== base && (!sourceId || (!source?.regions && !source?.component) || !sourceVisible)
    const destination = unavailable ? base : path
    batch(() => {
      if (model.workspace()?.id !== owner.id) model.chooseWorkspace(owner.id)
      setActiveTaskId(null)
      const selected = unavailable ? model.sources()[0]?.id : sourceId ?? model.sources()[0]?.id
      if (selected) selectLinkedSource(selected, owner.id)
      else setSelectedSource(null)
      navigate(destination)
    })
    if (unavailable) refuse(surface
      ? `The plugin page ${surface.id} has no terminal view; opened the project.`
      : `The project page ${path} is unavailable; opened the project.`)
  }

  switch (address.kind) {
    case 'task': {
      const task = model.allTasks().find((entry) => entry.id === address.taskId)
      if (!task) return refuse(`No task ${address.taskId} on this node.`)
      const owner = model.workspaces().find((workspace) => workspace.projects.some((project) => project.id === task.projectId))
      if (!owner) return refuse(`No project for task ${address.taskId} on this node.`)
      const pane = address.pane ? paneContribution(address.pane) : undefined
      if (address.pane && (!pane || !paneAvailable(pane, task))) return refuse(`The pane ${address.pane} is not available in this terminal.`)
      batch(() => {
        if (model.workspace()?.id !== owner.id) model.chooseWorkspace(owner.id)
        activateTaskSignals(task)
        navigate(`/t/${encodeURIComponent(task.id)}`)
        if (pane) {
          showPane(task, pane.id)
          if (address.item) openPane(task.id, pane.id, { kind: 'plugin:select', item: address.item })
        }
      })
      return
    }
    case 'project':
      return openProjectPath(`${projectPath(address.projectId)}${address.rest.map((part) => `/${encodeURIComponent(part)}`).join('')}`, address.projectId)
    case 'settings': {
      const target = address.pageId ? `settings/${address.pageId}${address.sectionId ? `#${address.sectionId}` : ''}` : undefined
      if (target && !placeFor(target)) return refuse(`The settings page ${address.pageId} is not available in this terminal.`)
      openSettings(target)
      return
    }
    case 'source':
      const source = sourceRegistry.get(address.sourceId)
      if ((!source?.regions && !source?.component) || !model.sources().some((entry) => entry.id === address.sourceId)) {
        return refuse(`The source ${address.sourceId} has no available terminal view.`)
      }
      selectLinkedSource(address.sourceId, model.workspace()?.id ?? 'loading')
      return
    case 'open': {
      if (!parseInAppTarget(address.url)) return refuse(`No content-link recogniser accepts ${address.url}.`)
      const path = inAppPathFor(address.url)
      if (!path) return refuse('This content link has no terminal view. Open it in the desktop app.')
      const task = matchRoute(TASK_ROUTE, path)
      if (task?.taskId) return openTerminalLink({ nodeId: address.nodeId, kind: 'task', taskId: task.taskId }, model)
      const projectId = path.startsWith('/p/') ? decodeURIComponent(path.split('/')[2] ?? '') : ''
      if (!projectId) return refuse('This content link has no terminal view. Open it in the desktop app.')
      return openProjectPath(path, projectId)
    }
    case 'new-task':
      // The CLI refuses this before opening a Node; keep the type exhaustive here.
      return
  }
}
