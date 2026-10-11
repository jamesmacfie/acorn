import { activeNodeId, nodeReady, readJson, writeJson } from '@acorn/plugin-api/client'
import {
  conflictRoute,
  operationRoute,
  type ConflictDetail,
  type ConflictResolve,
  type ConflictResolveResult,
  type OperationControl,
  type OperationControlAction,
  type OperationKind,
  type OperationResult,
  type OperationStart,
  type OperationState,
} from '../shared/api'

export const operationKey = (taskId: string) => ['git-operation', activeNodeId(), taskId] as const
export const operationOptions = (taskId: string) => ({
  queryKey: operationKey(taskId),
  queryFn: ({ signal }: { signal: AbortSignal }) => readJson<OperationState>(operationRoute(taskId), { signal }),
  enabled: nodeReady() && !!taskId,
  staleTime: 5_000,
})
const post = (url: string, body: unknown) =>
  writeJson<OperationResult>(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
export const operationActions = {
  start: (taskId: string, request: OperationStart) => post(operationRoute(taskId), request),
  control: (taskId: string, action: OperationControlAction, request: OperationControl) =>
    post(`${operationRoute(taskId)}/${action}`, request),
  resolve: (taskId: string, request: ConflictResolve) =>
    writeJson<ConflictResolveResult>(conflictRoute(taskId), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    }),
}

export const conflictKey = (taskId: string, path: string) => ['git-conflict', activeNodeId(), taskId, path] as const
export const conflictOptions = (taskId: string, path: string) => ({
  queryKey: conflictKey(taskId, path),
  queryFn: ({ signal }: { signal: AbortSignal }) => readJson<ConflictDetail>(conflictRoute(taskId, path), { signal }),
  enabled: nodeReady() && !!taskId,
  // A conflict read is checked again by every save, so a refresh is a person's choice, not a timer's.
  staleTime: Infinity,
  retry: false,
})

export const operationLabel: Record<OperationKind, string> = {
  merge: 'Merge',
  rebase: 'Rebase',
  'cherry-pick': 'Cherry-pick',
  revert: 'Revert',
}

/** The menu entries a commit offers. A merge commit offers no pick or revert: Acorn never guesses a mainline parent. */
export const operationChoices = (parentCount: number): Array<{ operation: OperationKind; label: string }> => [
  { operation: 'merge', label: 'Merge into task…' },
  { operation: 'rebase', label: 'Rebase task onto this…' },
  ...(parentCount <= 1
    ? [
        { operation: 'cherry-pick' as const, label: 'Cherry-pick into task…' },
        { operation: 'revert' as const, label: 'Revert in task…' },
      ]
    : []),
]

/** Index stages by their Git names. During a rebase "ours" is the branch being rebased onto. */
export const stageNames = (stages: number[]) =>
  stages.map((stage) => ['base', 'ours', 'theirs'][stage - 1] ?? `stage ${stage}`).join(', ')
