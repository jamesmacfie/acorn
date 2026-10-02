import type { WorkflowFileTarget } from '../../shared/workflowFileAuthoring'

/** Which store a definition came from, and its id there. The URL carries the pair as one string so a
 *  link is a link (docs/workflows.md § Authoring). */
export type DefRef = { source: 'database' | 'repo' | 'user'; id: string }

export const defRefKey = (ref: DefRef): string => `${ref.source === 'database' ? 'db' : ref.source}:${ref.id}`

/** Where a definition is kept, as a mark rather than a word. The list draws one per row and the editor
 *  one in its header, so both name the same three icons here. One line, because the icon census reads a
 *  name only off a line that mentions an icon (client-core scripts/icon-census.mjs). */
export const SOURCE_GLYPH: Record<DefRef['source'], { icon: string; title: string }> = { database: { icon: 'database', title: 'Saved in this workspace' }, repo: { icon: 'git-branch', title: 'Saved in the repository' }, user: { icon: 'user', title: 'Saved on this computer' } }

/** A key arrives either from the address, where it is encoded, or straight from `defRefKey`, where it
 *  is not. A malformed escape is not worth throwing over: the caller reads it as unparseable. */
const decodeItem = (item: string): string => {
  try {
    return decodeURIComponent(item)
  } catch {
    return item
  }
}

export function parseDefRef(item: string | undefined): DefRef | null {
  if (!item) return null
  // Decoded here, because Solid Router hands a path parameter back exactly as it sits in the address
  // and `workflowsSurfacePath` encodes the separator. Reading `db%3Aabc` as a definition nobody can
  // name is how the whole editor once opened read-only.
  const match = /^(db|repo|user):(.+)$/.exec(decodeItem(item))
  if (!match) return null
  return { source: match[1] === 'db' ? 'database' : (match[1] as 'repo' | 'user'), id: match[2] }
}

/** What the node is asked for, for a `repo:` or `user:` file. The row id it is stored under is the
 *  same string the URL carries minus the `db:` prefix. */
const routeId = (ref: DefRef): string => (ref.source === 'database' ? ref.id : `${ref.source}:${ref.id}`)

export type WorkflowDraftAddress = {
  key: string
  route: string
  projectId: string
  source: DefRef['source']
  entityId: string
  target: WorkflowFileTarget
  generation: number
}

export function workflowDraftAddress(ref: DefRef, projectId: string, generation: number): WorkflowDraftAddress {
  return { key: defRefKey(ref), route: routeId(ref), projectId, source: ref.source,
    entityId: ref.source === 'database' ? ref.id : `${projectId}:${routeId(ref)}`,
    target: { projectId, source: ref.source as 'repo' | 'user', path: `.acorn/workflows/${ref.id}.toml` }, generation }
}
