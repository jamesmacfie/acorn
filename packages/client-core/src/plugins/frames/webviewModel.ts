import type { PluginFrameSurface } from '@acorn/protocol/api.ts'
import { isAllowedWebviewUrl } from '@acorn/protocol/webview.ts'
import { readJson } from '../../apiClient'
import { ownsRoute } from '../chrome/data'
import type { FrameBinding } from './broker'

export const pluginWebviewKey = (binding: Pick<FrameBinding, 'pluginId' | 'surface' | 'taskId'>): string =>
  ['plugin', binding.pluginId, binding.surface, binding.taskId].filter((part) => part !== undefined).map((part) => encodeURIComponent(part!)).join(':')

const sourcePath = (path: string, binding: Pick<FrameBinding, 'taskId' | 'projectId'>): string => {
  const url = new URL(path, 'https://acorn.invalid')
  if (binding.taskId) url.searchParams.set('taskId', binding.taskId)
  if (binding.projectId) url.searchParams.set('projectId', binding.projectId)
  return `${url.pathname}${url.search}`
}

export async function resolvePluginWebviewUrl(
  pluginId: string,
  surface: PluginFrameSurface,
  binding: FrameBinding,
): Promise<string | null> {
  const hosts = surface.hosts ?? []
  if (surface.target !== 'webview' || !hosts.length) return null
  let url = surface.url
  if (!url && surface.urlSource) {
    const path = sourcePath(surface.urlSource, binding)
    if (!ownsRoute(pluginId, path)) return null
    const body = await readJson<{ url?: unknown }>(path, { nodeId: binding.nodeId })
    url = typeof body?.url === 'string' && body.url.length <= 2_048 ? body.url : undefined
  }
  return url && isAllowedWebviewUrl(url, hosts) ? url : null
}

export const displayHost = (url: string): string => {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}
