import { createEffect, createRoot } from 'solid-js'
import { activeNodeId, nodeReadiness, setActiveNode } from '../../../infra/node/activeNode'
import { homeNodeId, nodes } from '../../../infra/node/fleet'
import { toast } from '../../../features/notifications/toast'
import { pushNotice } from '../../../features/notifications/notifications'
import { setSelectedSource } from '../../../features/tasks/tasks'
import { defaultSourceId, matchRoute, sourceIdForPath, sourceRegistry } from '../sources/sources'
import { projectSurfaceRoutes } from '../panes/projectSurfaces'
import { paneContribution } from '../panes/panes'
import { openInAppUrl } from '../panes/contentLinks'
import { clientEvents } from './clientEvents'
import { projectPath, taskPath } from './corePaths'
import { buildLink, parseLink, type Address, type LinkRefusal } from './addresses'

export type AddressHost = {
  nodeId: string | null
  navigate(path: string): void
  openTask(taskId: string, path: string): boolean
  hasProject(projectId: string): boolean
}

let host: AddressHost | null = null
const waiting = new Set<() => void>()

/** A host registers only after its node cache, plugin routes, and startup restore are ready. */
export function registerAddressHost(next: AddressHost): () => void {
  host = next
  for (const wake of waiting) wake()
  return () => { if (host === next) host = null }
}

function readyHost(nodeId: string): Promise<AddressHost | null> {
  if (host?.nodeId === nodeId) return Promise.resolve(host)
  return new Promise((resolve) => {
    const timeout = setTimeout(() => { waiting.delete(wake); resolve(null) }, 15_000)
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
      const timeout = setTimeout(() => { dispose(); resolve() }, 15_000)
      createEffect(() => {
        if (nodeReadiness().kind === 'starting') return
        clearTimeout(timeout)
        queueMicrotask(() => { dispose(); resolve() })
      })
    })
  })
}

function refused(link: string, reason: string): LinkRefusal {
  const detail = `${reason}: ${link.length > 500 ? `${link.slice(0, 500)}…` : link}`
  pushNotice({ taskId: '', kind: 'error', title: 'Could not open Acorn link', detail, at: Date.now() })
  toast(detail, { tone: 'danger' })
  return { kind: 'refused', reason, link }
}

function linkForAddress(address: Address): string {
  if (address.kind === 'open' || address.kind === 'new-task') {
    return `acorn://${address.nodeId}/${address.kind}?${new URLSearchParams({ url: address.url })}`
  }
  try { return buildLink(address.nodeId, address) } catch { return `acorn://${address.nodeId}/${address.kind}` }
}

export async function openAddress(address: Address, link = ''): Promise<LinkRefusal | { kind: 'opened' }> {
  const shownLink = link || linkForAddress(address)
  // A cold-start OS event can arrive before the helper's first fleet answer. The shell already
  // starts that read; wait for its result instead of treating an empty projection as unpaired.
  if (!nodes().length) await waitForInitialFleet()
  const nodeId = address.nodeId === 'local' ? homeNodeId() : address.nodeId
  if (!nodeId || !nodes().some((node) => node.nodeId === nodeId)) return refused(shownLink, 'Node is not paired on this device')
  if (address.kind === 'new-task') return refused(shownLink, 'Creating a task from a link is not available yet')
  if (activeNodeId() !== nodeId) setActiveNode(nodeId)
  const shell = await readyHost(nodeId)
  if (!shell || activeNodeId() !== nodeId) return refused(shownLink, 'Node did not become ready to open the link')

  switch (address.kind) {
    case 'task': {
      const path = taskPath(address.taskId)
      if (address.pane && !paneContribution(address.pane)) {
        if (!shell.openTask(address.taskId, path)) return refused(shownLink, 'Task was not found')
        return refused(shownLink, 'Pane is unavailable; opened the task')
      }
      const query = address.pane
        ? `?${new URLSearchParams({ pane: address.pane, ...(address.item ? { item: address.item } : {}) })}`
        : ''
      if (!shell.openTask(address.taskId, `${path}${query}`)) return refused(shownLink, 'Task was not found')
      break
    }
    case 'project': {
      if (!shell.hasProject(address.projectId)) return refused(shownLink, 'Project was not found')
      const base = projectPath(address.projectId)
      const path = `${base}${address.rest.map((part) => `/${encodeURIComponent(part)}`).join('')}`
      const routeSource = sourceIdForPath(path)
      const source = routeSource && sourceRegistry.get(routeSource)?.when?.() !== false ? routeSource : undefined
      const surface = projectSurfaceRoutes().find((route) => matchRoute(route.path, path))
      const surfaceSource = surface && sourceRegistry.entries().find((entry) =>
        entry.projectSurfaceId === surface.id && entry.when?.() !== false)?.id
      if (address.rest.length && !source && !surfaceSource) {
        setSelectedSource(defaultSourceId() ?? null)
        shell.navigate(base)
        return refused(shownLink, 'Project page is unavailable; opened the project')
      }
      setSelectedSource(source ?? surfaceSource ?? defaultSourceId() ?? null)
      shell.navigate(path)
      break
    }
    case 'settings': {
      const target = `settings${address.pageId ? `/${address.pageId}` : ''}${address.sectionId ? `#${address.sectionId}` : ''}`
      clientEvents.emit('presentation:open-settings', { tab: target })
      break
    }
    case 'source':
      if (!sourceRegistry.get(address.sourceId) || sourceRegistry.get(address.sourceId)?.when?.() === false) {
        return refused(shownLink, 'Source is unavailable')
      }
      setSelectedSource(address.sourceId)
      break
    case 'open':
      if (!openInAppUrl(address.url, { prefer: 'route', navigate: shell.navigate })) {
        return refused(shownLink, 'No Acorn destination claims this URL')
      }
      break
  }
  return { kind: 'opened' }
}

export async function openLink(href: string): Promise<LinkRefusal | { kind: 'opened' }> {
  const parsed = parseLink(href)
  return parsed.kind === 'refused' ? refused(href, parsed.reason) : openAddress(parsed.address, href)
}
