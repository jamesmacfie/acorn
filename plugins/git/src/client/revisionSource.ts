import type { Accessor } from 'solid-js'
import type { DiffSource } from '@acorn/plugin-api/ui/diff'
import type { RevisionDetail } from '../shared/api'
import { revisionApi } from './historyClient'

export type RevisionTarget = {
  nodeId: string
  projectId: string
  taskId?: string
  id: string
  base: string | null
  comparison?: boolean
}

/** Capture one immutable comparison. The viewer owns viewport cancellation; this signal ends the target. */
export function revisionSource(
  target: RevisionTarget,
  detail: RevisionDetail,
  selectedPath: Accessor<string>,
  invalidate: () => void,
  lifetime: AbortSignal,
): DiffSource {
  const identity = JSON.stringify([
    target.nodeId,
    target.taskId ?? null,
    target.projectId,
    target.id,
    target.base,
    target.comparison ?? false,
  ])
  const combined = (signal: AbortSignal) => AbortSignal.any([signal, lifetime])
  return {
    scope: { routeKey: `git-revision:${identity}`, taskId: target.taskId },
    topology: () => detail.topology,
    loading: () => false,
    signature: () => `${identity}:${detail.topology.revision}`,
    selectedPath,
    loadSegments: async (requests, signal) => {
      const request = combined(signal)
      request.throwIfAborted()
      const result = await revisionApi.segments(
        target.projectId,
        target.id,
        target.base,
        requests,
        request,
        target.comparison,
      )
      request.throwIfAborted()
      return result
    },
    search: async (request, signal) => {
      const read = combined(signal)
      read.throwIfAborted()
      const result = await revisionApi.search(
        target.projectId,
        target.id,
        target.base,
        request,
        read,
        target.comparison,
      )
      read.throwIfAborted()
      return result
    },
    fileText: async ({ path, sha }) => {
      lifetime.throwIfAborted()
      const result = await revisionApi.file(
        target.projectId,
        target.id,
        target.base,
        path,
        sha,
        lifetime,
        target.comparison,
      )
      lifetime.throwIfAborted()
      return result.text
    },
    canComment: () => false,
    invalidate,
    draftPrefix: `git-revision:${identity}`,
    find: { commandId: 'git.revision.find', description: 'Find in revision', category: 'Git' },
  }
}
