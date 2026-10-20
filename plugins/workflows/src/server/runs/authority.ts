import { isRepoConfigTrustError } from '@acorn/plugin-api/node'
import type { WorkflowAuthorityReason } from '../../shared/workflowContracts'

/** An unattended start refused for a reason only the owner can fix. A trigger moves to Needs review on
 *  this type, and retries any other failure as a passing fault. */
export class WorkflowAuthorityError extends Error {
  constructor(
    readonly reason: WorkflowAuthorityReason,
    message: string,
  ) {
    super(message)
    this.name = 'WorkflowAuthorityError'
  }
}

/** Data-source refusals carry a `code`, and the repo trust gate its own type. The ones that need the
 *  owner become a WorkflowAuthorityError. Anything else passes through unchanged. */
export function asAuthorityError(error: unknown): unknown {
  if (error instanceof WorkflowAuthorityError) return error
  const message = error instanceof Error ? error.message : String(error)
  if (isRepoConfigTrustError(error)) return new WorkflowAuthorityError('untrusted', message)
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
  return code === 'forbidden' || code === 'connection-required' || code === 'input-required'
    ? new WorkflowAuthorityError(code, message)
    : error
}
