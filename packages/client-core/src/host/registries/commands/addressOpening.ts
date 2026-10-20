import { createEffect, createRoot } from 'solid-js'
import { activeNodeId, nodeReadiness, setActiveNode } from '../../../infra/node/activeNode'
import { homeNodeId, nodes } from '../../../infra/node/fleet'
import { toast } from '../../../features/notifications/toast'
import { pushNotice } from '../../../features/notifications/notifications'
import { setSelectedSource } from '../../../features/tasks/tasks'
import { defaultSourceId, matchRoute, sourceIdForPath, sourceRegistry } from '../sources/sources'
import { projectSurfaceRoutes } from '../panes/projectSurfaces'
import { paneContribution } from '../panes/panes'
import { claimFor, openInAppUrl } from '../panes/contentLinks'
import type { Task } from '@acorn/protocol/api.ts'
import { clientEvents } from './clientEvents'
import { isProjectPath, projectIdFromPath, projectPath, taskPath } from './corePaths'
import { buildLink, parseLink, taskQuery, type Address, type LinkRefusal } from './addresses'

export type AddressHost = {
  nodeId: string | null
  navigate(path: string): void
  openProject(path: string, source: string | null): void
  openTask(taskId: string, path: string, task?: Task): boolean
  hasProject(projectId: string): boolean
  loadProjects(): Promise<void>
  showPromotion(details: { projectId: string; sourceId: string; item: unknown; itemTitle: string }): void
}

let host: AddressHost | null = null
const waiting = new Set<() => void>()

/** A host registers only after its node cache, plugin routes, and startup restore are ready.
 * See docs/frontend/acorn-links.md § Input and authority.
 */
export function registerAddressHost(next: AddressHost): () => void {
  host = next
  for (const wake of waiting) wake()
  return () => {
    if (host === next) host = null
  }
}

function readyHost(nodeId: string): Promise<AddressHost | null> {
  if (host?.nodeId === nodeId) return Promise.resolve(host)
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      waiting.delete(wake)
      resolve(null)
    }, 15_000)
    const wake = () => {
      if (host?.nodeId !== nodeId) return
      waiting.delete(wake)
      clearTimeout(timeout)
      resolve(host)
    }
    waiting.add(wake)
  })
}

function waitForInitialFleet(): Promise<void> {
  if (nodeReadiness().kind !== 'starting') return Promise.resolve()
  return new Promise((resolve) => {
    createRoot((dispose) => {
      const timeout = setTimeout(() => {
        dispose()
        resolve()
      }, 15_000)
      createEffect(() => {
        if (nodeReadiness().kind === 'starting') return
        clearTimeout(timeout)
        queueMicrotask(() => {
          dispose()
          resolve()
        })
      })
    })
  })
}

export function reportLinkFailure(link: string, reason: string, addProject = false): LinkRefusal {
  const detail = `${reason}: ${link.length > 500 ? `${link.slice(0, 500)}…` : link}`
  pushNotice({
    taskId: '',
    kind: 'error',
    title: 'Could not open Acorn link',
    detail,
    at: Date.now(),
    ...(addProject ? { target: { kind: 'settings', resourceId: 'workspaces#projects' } } : {}),
  })
  toast(detail, {
    tone: 'danger',
    ...(addProject
      ? {
          action: {
            label: 'Add project',
            onPress: () => clientEvents.emit('presentation:open-settings', { tab: 'settings/workspaces#projects' }),
          },
        }
      : {}),
  })
  return { kind: 'refused', reason, link }
}

function linkForAddress(address: Address): string {
  if (address.kind === 'open' || address.kind === 'new-task') {
    return `acorn://${address.nodeId}/${address.kind}?${new URLSearchParams({ url: address.url })}`
  }
  try {
    return buildLink(address.nodeId, address)
  } catch {
    return `acorn://${address.nodeId}/${address.kind}`
  }
}

async function openAddress(address: Address, link = ''): Promise<LinkRefusal | { kind: 'opened' }> {
  const shownLink = link || linkForAddress(address)
  // A cold-start OS event can arrive before the helper's first fleet answer. The shell already
  // starts that read; wait for its result instead of treating an empty projection as unpaired.
  if (!nodes().length) await waitForInitialFleet()
  const nodeId = address.nodeId === 'local' ? homeNodeId() : address.nodeId
  if (!nodeId || !nodes().some((node) => node.nodeId === nodeId))
    return reportLinkFailure(shownLink, 'Node is not paired on this device')
  if (activeNodeId() !== nodeId) setActiveNode(nodeId)
  const shell = await readyHost(nodeId)
  if (!shell || activeNodeId() !== nodeId)
    return reportLinkFailure(shownLink, 'Node did not become ready to open the link')

  switch (address.kind) {
    case 'task': {
      const path = taskPath(address.taskId)
      if (address.pane && !paneContribution(address.pane)) {
        if (!shell.openTask(address.taskId, path)) return reportLinkFailure(shownLink, 'Task was not found')
        return reportLinkFailure(shownLink, 'Pane is unavailable; opened the task')
      }
      const query = address.pane ? `?${taskQuery(address.pane, address.item, address.at)}` : ''
      if (!shell.openTask(address.taskId, `${path}${query}`)) return reportLinkFailure(shownLink, 'Task was not found')
      break
    }
    case 'project': {
      if (!shell.hasProject(address.projectId)) return reportLinkFailure(shownLink, 'Project was not found')
      const base = projectPath(address.projectId)
      const path = `${base}${address.rest.map((part) => `/${encodeURIComponent(part)}`).join('')}`
      const routeSource = sourceIdForPath(path)
      const source = routeSource && sourceRegistry.get(routeSource)?.when?.() !== false ? routeSource : undefined
      const surface = projectSurfaceRoutes().find((route) => matchRoute(route.path, path))
      const surfaceSource =
        surface &&
        sourceRegistry.entries().find((entry) => entry.projectSurfaceId === surface.id && entry.when?.() !== false)?.id
      if (address.rest.length && !source && !surfaceSource) {
        shell.openProject(base, defaultSourceId() ?? null)
        return reportLinkFailure(shownLink, 'Project page is unavailable; opened the project')
      }
      shell.openProject(path, source ?? surfaceSource ?? defaultSourceId() ?? null)
      break
    }
    case 'settings': {
      const target = `settings${address.pageId ? `/${address.pageId}` : ''}${address.sectionId ? `#${address.sectionId}` : ''}`
      clientEvents.emit('presentation:open-settings', { tab: target })
      break
    }
    case 'source':
      if (!sourceRegistry.get(address.sourceId) || sourceRegistry.get(address.sourceId)?.when?.() === false) {
        return reportLinkFailure(shownLink, 'Source is unavailable')
      }
      setSelectedSource(address.sourceId)
      break
    case 'open':
      if (
        !openInAppUrl(address.url, {
          prefer: 'route',
          openRoute: (path, source) => {
            if (isProjectPath(path)) shell.openProject(path, source ?? defaultSourceId() ?? null)
            else {
              if (source) setSelectedSource(source)
              shell.navigate(path)
            }
          },
        })
      ) {
        return reportLinkFailure(shownLink, 'No Acorn destination claims this URL')
      }
      break
    case 'new-task': {
      const ownsRequest = () => host === shell && activeNodeId() === nodeId
      const staleRequest = (): LinkRefusal => ({
        kind: 'refused',
        reason: 'Node changed while opening the link',
        link: shownLink,
      })
      if (!ownsRequest()) return staleRequest()
      let claim: ReturnType<typeof claimFor>
      try {
        claim = claimFor(address.url)
      } catch {
        return reportLinkFailure(shownLink, 'Could not recognise this URL')
      }
      if (!claim) return reportLinkFailure(shownLink, 'No Acorn recogniser claims this URL')
      try {
        await shell.loadProjects()
      } catch {
        if (!ownsRequest()) return staleRequest()
        return reportLinkFailure(shownLink, 'Could not load projects for this Node')
      }
      if (!ownsRequest()) return staleRequest()
      if (!claim.contribution.path) return reportLinkFailure(shownLink, 'Provider has no task promotion')
      let projectId: string | null
      try {
        const path = claim.contribution.path(claim.target)
        projectId = path ? projectIdFromPath(path) : null
      } catch {
        return reportLinkFailure(shownLink, 'Could not resolve the item project')
      }
      if (!projectId || !shell.hasProject(projectId)) {
        return reportLinkFailure(shownLink, 'Repository is not a project in Acorn', true)
      }
      const source = sourceRegistry
        .entries()
        .find(
          (entry) =>
            entry.providerId === claim.contribution.providerId &&
            entry.promotion?.fromContentLink &&
            entry.when?.() !== false,
        )
      if (!source?.promotion?.fromContentLink) return reportLinkFailure(shownLink, 'Provider has no task promotion')
      try {
        const task: Task | undefined = await source.promotion.existingTask?.(claim.target, projectId)
        if (!ownsRequest()) return staleRequest()
        if (task) {
          if (!shell.openTask(task.id, taskPath(task.id), task))
            return reportLinkFailure(shownLink, 'Task was not found')
          break
        }
        const item = await source.promotion.fromContentLink(claim.target, projectId)
        if (!ownsRequest()) return staleRequest()
        if (!item || !source.promotion.canPromote(item, { projectId })) {
          return reportLinkFailure(shownLink, 'Provider cannot promote this item')
        }
        shell.openProject(projectPath(projectId), source.id)
        shell.showPromotion({
          projectId,
          sourceId: source.id,
          item,
          itemTitle: typeof item.title === 'string' ? item.title : address.url,
        })
      } catch (error) {
        if (!ownsRequest()) return staleRequest()
        return reportLinkFailure(shownLink, error instanceof Error ? error.message : 'Could not load the item')
      }
      break
    }
  }
  return { kind: 'opened' }
}

export async function openLink(href: string): Promise<LinkRefusal | { kind: 'opened' }> {
  const parsed = parseLink(href)
  return parsed.kind === 'refused' ? reportLinkFailure(href, parsed.reason) : openAddress(parsed.address, href)
}
