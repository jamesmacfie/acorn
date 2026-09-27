import { createSignal } from 'solid-js'
import type { InlineDiffOrigin } from '../../contract/inlineDiff.ts'

type Scope = Pick<InlineDiffOrigin, 'taskId' | 'source' | 'scope' | 'pull'>
const keyFor = (scope: Scope) => JSON.stringify([scope.taskId, scope.source, scope.scope, scope.pull?.owner, scope.pull?.repo, scope.pull?.number])
const [documents, setDocuments] = createSignal(new Map<string, Record<string, string | null>>())

export const reportPatches = (scope: Scope, patches: Record<string, string | null>): void => {
  setDocuments((previous) => {
    const next = new Map(previous)
    next.delete(keyFor(scope))
    next.set(keyFor(scope), patches)
    if (next.size > 100) next.delete(next.keys().next().value!)
    return next
  })
}

export const isStale = (origin: InlineDiffOrigin): boolean | null => {
  const patches = documents().get(keyFor(origin))
  return patches ? patches[origin.path] !== origin.patchKey : null
}
