export const instructionReviewRoute = '/v1/p/agents/instruction-review'

export type InstructionReviewTask = { id: string; title: string; projectId: string }
export type InstructionFinding = {
  file: string
  line: number
  category: 'command' | 'domain' | 'sensitive-path' | 'permission' | 'override' | 'hidden-character' | 'unsupported'
  detail: string
}
export type InstructionChange = {
  path: string
  status: 'added' | 'changed' | 'removed' | 'retargeted'
  patch: string | null
  beforeCanonical: string | null
  afterCanonical: string | null
}
export type InstructionReview = {
  id: string | null
  taskId: string
  projectId: string
  digest: string
  scope: string
  analyzerVersion: number
  baseline: boolean
  /** True only when this exact snapshot matches a readable, approved review. */
  approved?: boolean
  /** A complete scan found no instruction or skill files, so approval is unnecessary. */
  empty?: boolean
  findings: InstructionFinding[]
  changes: InstructionChange[]
  limits: string
}
