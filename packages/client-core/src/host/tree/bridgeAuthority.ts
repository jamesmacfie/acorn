import type { QueryClient } from '@tanstack/solid-query'
import type { PluginFrameContext } from '@acorn/protocol/plugin/bridge.ts'
import type { FrameBinding } from '../frames/broker'
import type { PluginFrameProps } from '../frames/frameServices'

const identities = new WeakMap<object, number>()
type DocumentAccessor = NonNullable<PluginFrameProps['document']>
type DocumentGrant = { generation: object; handle: ReturnType<DocumentAccessor> }
const documentGrants = new WeakMap<DocumentAccessor, DocumentGrant>()
let identitySequence = 0
const identity = (value: object | undefined): number => {
  if (!value) return 0
  const existing = identities.get(value)
  if (existing !== undefined) return existing
  const next = ++identitySequence
  identities.set(value, next)
  return next
}

/** The composed owner calls this for every actual handle publication, including withdrawal. */
export function refreshTreeDocumentGrant(document: DocumentAccessor): DocumentGrant {
  const handle = document()
  const previous = documentGrants.get(document)
  if (previous && (!previous.handle || previous.handle === handle)) {
    previous.handle = handle
    return previous
  }
  const grant = { generation: {}, handle }
  documentGrants.set(document, grant)
  return grant
}

/** Equivalent model state excludes the one-shot opening selection, while retaining every grant. */
export const treeModelAuthorityKey = (
  hash: string,
  qc: QueryClient,
  binding: FrameBinding,
  context: PluginFrameContext,
  document: PluginFrameProps['document'],
): string => JSON.stringify([
  hash, identity(qc), binding.pluginId, binding.surface, binding.target, binding.nodeId,
  binding.taskId ?? null, binding.projectId ?? null,
  [...binding.api].sort(), [...binding.events].sort(), [...binding.panes].sort(),
  binding.destinations ?? [], [...(binding.hosts ?? [])].sort(), [...binding.claimsKeys].sort(),
  identity(document), document ? identity(refreshTreeDocumentGrant(document).generation) : 0,
])

/** Legacy global connect().context retains its immutable initial selection as well as its grants. */
export const treeAuthorityKey = (
  hash: string, qc: QueryClient, binding: FrameBinding, context: PluginFrameContext,
  document: PluginFrameProps['document'],
): string => JSON.stringify([treeModelAuthorityKey(hash, qc, binding, context, document), context.item ?? null])

/** A structural grant may arrive after its sibling editor loads. It may not later become another
 * document through the same reactive accessor. Null after admission permanently retires the grant. */
export function treeDocumentGrant(document: PluginFrameProps['document']): PluginFrameProps['document'] {
  if (!document) return undefined
  let accessor: typeof document | null = document
  const generation = refreshTreeDocumentGrant(accessor).generation
  let retired = false
  return () => {
    if (retired) throw new Error('this tree document grant was retired')
    const current = refreshTreeDocumentGrant(accessor!)
    if (current.generation !== generation) {
      retired = true
      accessor = null
      throw new Error('this tree document grant was retired')
    }
    return current.handle
  }
}
