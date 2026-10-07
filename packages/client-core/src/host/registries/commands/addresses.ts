import { projectPath, taskPath } from './corePaths'

export const MAX_LINK_LENGTH = 4096

export type Address = { nodeId: string } & Place
export type Place =
  | { kind: 'task'; taskId: string; pane?: string; item?: string }
  | { kind: 'project'; projectId: string; rest: string[] }
  | { kind: 'settings'; pageId?: string; sectionId?: string }
  | { kind: 'source'; sourceId: string }
  | { kind: 'open'; url: string }
  | { kind: 'new-task'; url: string }

export type LinkRefusal = { kind: 'refused'; reason: string; link: string }
export type LinkResult = { kind: 'address'; address: Address } | LinkRefusal

const refuse = (link: string, reason: string): LinkRefusal => ({ kind: 'refused', reason, link })
const hostPattern = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/

function segment(value: string): string | null {
  try {
    const decoded = decodeURIComponent(value)
    return decoded && decoded !== '.' && decoded !== '..' && !/[?#\\\u0000-\u001f]/.test(decoded) ? decoded : null
  } catch {
    return null
  }
}

function outsideUrl(value: string | null): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname ? value : null
  } catch {
    return null
  }
}

/** One decode at each component boundary. No browser or renderer state is loaded here. */
export function parseLink(href: string): LinkResult {
  if (href.length > MAX_LINK_LENGTH) return refuse(href, 'Link is too long')
  const authority = /^acorn:\/\/([^/?#]*)/.exec(href)?.[1]
  if (authority === undefined) return refuse(href, 'Expected an acorn:// link')
  if (!authority || !hostPattern.test(authority)) return refuse(href, 'Missing or invalid Node ID')
  let url: URL
  try { url = new URL(href) } catch { return refuse(href, 'Malformed link') }
  if (url.protocol !== 'acorn:' || url.host !== authority || url.username || url.password || url.port) {
    return refuse(href, 'Invalid Node address')
  }
  const parts = url.pathname.split('/').slice(1)
  const decoded = parts.map(segment)
  if (decoded.some((part) => part === null)) return refuse(href, 'Invalid path segment')
  const [form, id, ...rest] = decoded as string[]
  const params = url.searchParams
  const only = (...names: string[]) => [...params.keys()].every((key) => names.includes(key))
    && names.every((key) => params.getAll(key).length <= 1)
  let place: Place
  if (form === 't' && id && !rest.length && !url.hash && only('pane', 'item')) {
    const pane = params.get('pane') ?? undefined
    const item = params.get('item') ?? undefined
    if (params.has('pane') !== params.has('item') || (params.has('pane') && (!pane || !item))) {
      return refuse(href, 'Task pane and item must appear together')
    }
    place = { kind: 'task', taskId: id, ...(pane && item ? { pane, item } : {}) }
  } else if (form === 'p' && id && !url.search && !url.hash) {
    place = { kind: 'project', projectId: id, rest }
  } else if (form === 'settings' && !rest.length && !url.search) {
    const pageId = id || undefined
    const sectionId = url.hash ? segment(url.hash.slice(1)) : undefined
    if (sectionId === null) return refuse(href, 'Invalid settings section')
    place = { kind: 'settings', ...(pageId ? { pageId } : {}), ...(sectionId ? { sectionId } : {}) }
  } else if (form === 'source' && id && !rest.length && !url.search && !url.hash) {
    place = { kind: 'source', sourceId: id }
  } else if ((form === 'open' || form === 'new-task') && !id && !rest.length && !url.hash && only('url')) {
    const target = outsideUrl(params.get('url'))
    if (!target) return refuse(href, 'Expected an http or https URL')
    place = { kind: form, url: target }
  } else {
    return refuse(href, 'Unknown or malformed Acorn address')
  }
  return { kind: 'address', address: { nodeId: authority, ...place } }
}

/** Build the stable, copyable navigation forms. Node IDs are written explicitly. */
export function buildLink(nodeId: string, place: Extract<Place, { kind: 'task' | 'project' | 'settings' | 'source' }>): string {
  if (!hostPattern.test(nodeId)) throw new Error('Invalid Node ID')
  const values = place.kind === 'task' ? [place.taskId, place.pane, place.item]
    : place.kind === 'project' ? [place.projectId, ...place.rest]
      : place.kind === 'settings' ? [place.pageId, place.sectionId] : [place.sourceId]
  if (values.some((value) => value !== undefined && segment(encodeURIComponent(value)) !== value)) {
    throw new Error('Invalid address segment')
  }
  let path: string
  switch (place.kind) {
    case 'task': {
      if (!!place.pane !== !!place.item) throw new Error('Task pane and item must appear together')
      path = taskPath(place.taskId)
      if (place.pane && place.item) path += `?${new URLSearchParams({ pane: place.pane, item: place.item })}`
      break
    }
    case 'project': path = `${projectPath(place.projectId)}${place.rest.map((part) => `/${encodeURIComponent(part)}`).join('')}`; break
    case 'settings': path = `/settings${place.pageId ? `/${encodeURIComponent(place.pageId)}` : ''}${place.sectionId ? `#${encodeURIComponent(place.sectionId)}` : ''}`; break
    case 'source': path = `/source/${encodeURIComponent(place.sourceId)}`; break
  }
  return `acorn://${nodeId}${path}`
}
