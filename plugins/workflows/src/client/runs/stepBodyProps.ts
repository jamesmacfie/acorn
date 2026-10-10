import type { DataValue } from '@acorn/protocol/dataValues.ts'
import type { WorkflowStepRow } from '../../contract/wire.ts'
import { MAX_STEP_BODY_JSON_BYTES, MAX_STEP_BODY_TAIL_LINES, type WorkflowStepBodyProps } from '../../contract/stepBody.ts'

// What a `workflows:step-body` provider is handed for the selected step (../../contract/stepBody.ts).
// One function, so the bounds live in one place and a test can hold them.

const encoder = new TextEncoder()

/** UTF-8 bytes are at least one and at most three per UTF-16 unit, so only text between the two bounds
 *  is encoded. A 5 MB HTTP body is refused without being copied on every tail update. */
const tooBig = (raw: string): boolean =>
  raw.length > MAX_STEP_BODY_JSON_BYTES || (raw.length * 3 > MAX_STEP_BODY_JSON_BYTES && encoder.encode(raw).length > MAX_STEP_BODY_JSON_BYTES)

/** A stored JSON column, parsed, or `null` with a reason. Too big is checked on the stored text, which
 *  is the serialized size the contract caps. */
function project(raw: string | null | undefined): { value: DataValue | null; truncated: boolean } {
  if (!raw) return { value: null, truncated: false }
  if (tooBig(raw)) return { value: null, truncated: true }
  try {
    return { value: JSON.parse(raw) as DataValue, truncated: false }
  } catch {
    return { value: null, truncated: false }
  }
}

export function stepBodyProps(input: {
  taskId: string
  projectId: string
  step: WorkflowStepRow
  /** The run pane's live tail for this step. The model already caps it at 4,000 characters, well
   *  under the contract's 64 KiB, so only the line count is cut here. */
  tail: readonly string[]
  revision: number
}): WorkflowStepBodyProps {
  const inputs = project(input.step.inputsJson)
  const output = project(input.step.structuredJson)
  return {
    taskId: input.taskId,
    projectId: input.projectId,
    runId: input.step.runId,
    stepId: input.step.id,
    kind: input.step.kind,
    status: input.step.status,
    inputs: inputs.value,
    inputsTruncated: inputs.truncated,
    output: output.value,
    outputTruncated: output.truncated,
    ...(input.tail.length ? { tail: input.tail.slice(-MAX_STEP_BODY_TAIL_LINES) } : {}),
    revision: input.revision,
  }
}
