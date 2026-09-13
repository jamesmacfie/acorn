// Generating or editing a definition with AI (docs/workflows.md § Authoring): the wire types, and
// the one instruction cap both halves read.
//
// Here rather than beside the prompt for the reason the changes plugin keeps
// `COMMIT_MESSAGE_MAX_PROMPT_CHARS` in its own `shared/api.ts`: the modal's textarea and the route's
// Zod bound are the same number, and a number written twice is a number that drifts. The routes
// themselves stay in ../client/workflowsClient.ts with the rest of this plugin's namespace.

import type { WorkflowRunRow as WireWorkflowRunRow, WorkflowStepRow as WireWorkflowStepRow } from '@acorn/protocol/workflow.ts'
import type { WorkflowDef, WorkflowInput } from './workflowContracts'

export type WorkflowUsageSummary = {
  costUsd: number
  inputTokens: number
  outputTokens: number
  turns: number
}

/** One admitted child workflow, projected from the dispatch ledger and child run row. */
export type WorkflowChildRunSummary = {
  parentTaskId: string
  parentRunId: string
  parentStepId: string
  itemKey: string | null
  taskId: string
  runId: string
  name: string | null
  dispatchState: 'reserved' | 'task-created' | 'run-started' | 'cancelling' | 'terminal'
  runStatus: 'running' | 'gated' | 'cancelling' | 'done' | 'failed' | 'safety-rail' | 'cancelled' | null
  resultSummary: string | null
  error: string | null
  usage: WorkflowUsageSummary | null
  updatedAt: number
}

export type WorkflowRunProjection = WireWorkflowRunRow & {
  rootRunId: string | null
  parentRunId: string | null
  parentStepId: string | null
  rootTaskId: string
  rootRunName: string
  parentTaskId: string | null
  parentRunName: string | null
  depth: number
  /** Root runs report the complete tree. Child runs report only their own admitted turns. */
  usage: WorkflowUsageSummary | null
}

export type WorkflowStepProjection = WireWorkflowStepRow & {
  children: WorkflowChildRunSummary[]
}

/** How much description or edit instruction the modal takes and the route accepts.
 *
 *  Twice the changes plugin's diff budget and eight times the database plugin's prompt budget,
 *  because this one is the whole brief for a graph rather than a sentence about one query. A reader
 *  pasting an issue in is doing the right thing. */
export const GENERATE_MAX_DESCRIPTION_CHARS = 8_000

/** The body the generate route carries.
 *
 *  `backendId` and `modelId` are the pair every generate in the repo sends, so the same picker
 *  serves all three. `workspaceId` is what the workspace's own definitions are read from, and
 *  `defId` is the one they are read without: a definition is a poor worked example of itself. The
 *  mode-specific fields distinguish replacement hints from the definition an edit transforms. */
type WorkflowGenerateRequestBase = {
  backendId: string
  modelId?: string
  description: string
  workspaceId: string
  projectId?: string
  defId?: string
}

/** Generate a replacement from a brief, or transform the definition already in the editor.
 *
 *  The modes are a discriminated union because an edit without the current definition would quietly
 *  behave like an overwrite. Conversely, an overwrite carries only the name and inputs that the old
 *  generate path has always treated as hints; it does not send the rest of the draft to the model. */
export type WorkflowGenerateRequest = WorkflowGenerateRequestBase & (
  | { mode: 'overwrite'; name?: string; inputs?: WorkflowInput[] }
  | { mode: 'edit'; currentDef: WorkflowDef }
)

/** Why the definition that came back is not the definition being applied.
 *
 *  The code is stable and a test asserts on it; the message is what the reader sees, and names the
 *  step and the offending value. One code per row of the grounding table
 *  (../server/groundWorkflow.ts), so a note can be counted and grouped without reading English.
 *
 *  `dropped-step` is the one code with no row of its own: it is raised while parsing, for an entry
 *  of the steps array that is not a step at all. Grounding never deletes a step. */
export type WorkflowGenerateNoteCode =
  | 'dropped-step'
  | 'unknown-kind'
  | 'unknown-policy'
  | 'unknown-profile'
  | 'unknown-with-key'
  | 'with-on-builtin'
  | 'unknown-key'
  | 'forbidden-key'
  | 'renamed-step'
  | 'unknown-step-reference'
  | 'cyclic-reference'
  | 'added-edge'
  | 'malformed-reference'
  | 'declared-input'
  | 'dropped-schema'
  | 'unknown-workflow'
  | 'unsupported-binding'

export type WorkflowGenerateNote = { code: WorkflowGenerateNoteCode; message: string; step?: string }

/** What the route answers.
 *
 *  `problems` is what the validator still says about `def`, which the editor's footer draws anyway;
 *  it rides along so the modal can say the answer is not clean before the draft is replaced.
 *  `providerId` and `modelId` are for the reader, as the database and changes results carry them:
 *  a bad answer can be traced to the model that wrote it. */
export type WorkflowGenerateResult = {
  def: WorkflowDef
  notes: WorkflowGenerateNote[]
  problems: string[]
  /** Whether the repair pass ran and its answer is the one here. */
  repaired: boolean
  providerId: string
  modelId: string
}
