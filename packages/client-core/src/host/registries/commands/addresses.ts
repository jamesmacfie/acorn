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

function queryParams(raw: string | undefined): Map<string, string[]> | null {
  const params = new Map<string, string[]>()
  if (!raw) return params
  for (const pair of raw.split('&')) {
    if (!pair) return null
    const equals = pair.indexOf('=')
    const encodedKey = equals < 0 ? pair : pair.slice(0, equals)
    const encodedValue = equals < 0 ? '' : pair.slice(equals + 1)
    try {
      // Query strings use form encoding: + is a space. Decode here rather than relying on
      // URLSearchParams, which replaces malformed escapes instead of reporting them.
      const key = decodeURIComponent(encodedKey.replace(/\+/g, ' '))
      const value = decodeURIComponent(encodedValue.replace(/\+/g, ' '))
      if (!key) return null
      params.set(key, [...(params.get(key) ?? []), value])
    } catch {
      return null
    }
  }
  return params
}

/** One decode at each component boundary. No browser or renderer state is loaded here.
 * See docs/frontend/acorn-links.md § Input and authority.
 */
export function parseLink(href: string): LinkResult {
  if (href.length > MAX_LINK_LENGTH) return refuse(href, 'Link is too long')
  // Read the raw path before URL normalizes dot segments. A normalized `/p/a/../b` would name a
  // different place than the sender wrote, even when each dot was percent-encoded.
  const match = /^acorn:\/\/([^/?#]*)([^?#]*)(?:\?([^#]*))?(?:#([\s\S]*))?$/.exec(href)
  if (!match) return refuse(href, 'Expected an acorn:// link')
  const [, authority, rawPath, rawQuery, rawFragment] = match
  if (!authority || !hostPattern.test(authority)) return refuse(href, 'Missing or invalid Node ID')
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return refuse(href, 'Malformed link')
  }
  if (url.protocol !== 'acorn:' || url.host !== authority || url.username || url.password || url.port) {
    return refuse(href, 'Invalid Node address')
  }
  const decoded = rawPath.startsWith('/') ? rawPath.slice(1).split('/').map(segment) : []
  if (decoded.some((part) => part === null)) return refuse(href, 'Invalid path segment')
  const [form, id, ...rest] = decoded as string[]
  const params = queryParams(rawQuery)
  if (!params) return refuse(href, 'Invalid query encoding')
  const only = (...names: string[]) =>
    [...params.keys()].every((key) => names.includes(key)) && names.every((key) => (params.get(key)?.length ?? 0) <= 1)
  const value = (key: string): string | undefined => params.get(key)?.[0]
  let place: Place
  if (form === 't' && id && !rest.length && !rawFragment && only('pane', 'item')) {
    const pane = value('pane')
    const item = value('item')
    if ((params.has('pane') && !pane) || (params.has('item') && (!pane || !item))) {
      return refuse(href, 'An item needs a pane, and both values must be nonempty')
    }
    place = { kind: 'task', taskId: id, ...(pane ? { pane } : {}), ...(item ? { item } : {}) }
  } else if (form === 'p' && id && !rawQuery && !rawFragment) {
    place = { kind: 'project', projectId: id, rest }
  } else if (form === 'settings' && !rest.length && !rawQuery) {
    const pageId = id || undefined
    const sectionId = rawFragment ? segment(rawFragment) : undefined
    if (sectionId === null) return refuse(href, 'Invalid settings section')
    place = { kind: 'settings', ...(pageId ? { pageId } : {}), ...(sectionId ? { sectionId } : {}) }
  } else if (form === 'source' && id && !rest.length && !rawQuery && !rawFragment) {
    place = { kind: 'source', sourceId: id }
  } else if ((form === 'open' || form === 'new-task') && !id && !rest.length && !rawFragment && only('url')) {
    const target = outsideUrl(value('url') ?? null)
    if (!target) return refuse(href, 'Expected an http or https URL')
    place = { kind: form, url: target }
  } else {
    return refuse(href, 'Unknown or malformed Acorn address')
  }
  return { kind: 'address', address: { nodeId: authority, ...place } }
}

/** Build the stable, copyable navigation forms, and `open` for an outside item. Node IDs are written
 * explicitly. See docs/frontend/acorn-links.md § Address forms.
 */
export function buildLink(
  nodeId: string,
  place: Extract<Place, { kind: 'task' | 'project' | 'settings' | 'source' | 'open' }>,
): string {
  if (!hostPattern.test(nodeId)) throw new Error('Invalid Node ID')
  const values =
    place.kind === 'task'
      ? [place.taskId, place.pane, place.item]
      : place.kind === 'project'
        ? [place.projectId, ...place.rest]
        : place.kind === 'settings'
          ? [place.pageId, place.sectionId]
          : place.kind === 'source'
            ? [place.sourceId]
            : []
  if (values.some((value) => value !== undefined && segment(encodeURIComponent(value)) !== value)) {
    throw new Error('Invalid address segment')
  }
  let path: string
  switch (place.kind) {
    case 'task': {
      if (place.item && !place.pane) throw new Error('A task item needs a pane')
      path = taskPath(place.taskId)
      if (place.pane)
        path += `?${new URLSearchParams({ pane: place.pane, ...(place.item ? { item: place.item } : {}) })}`
      break
    }
    case 'project':
      path = `${projectPath(place.projectId)}${place.rest.map((part) => `/${encodeURIComponent(part)}`).join('')}`
      break
    case 'settings':
      path = `/settings${place.pageId ? `/${encodeURIComponent(place.pageId)}` : ''}${place.sectionId ? `#${encodeURIComponent(place.sectionId)}` : ''}`
      break
    case 'source':
      path = `/source/${encodeURIComponent(place.sourceId)}`
      break
    case 'open':
      if (!outsideUrl(place.url)) throw new Error('Expected an http or https URL')
      path = `/open?${new URLSearchParams({ url: place.url })}`
      break
  }
  const href = `acorn://${nodeId}${path}`
  if (href.length > MAX_LINK_LENGTH) throw new Error(`Acorn link exceeds ${MAX_LINK_LENGTH} characters`)
  return href
}
