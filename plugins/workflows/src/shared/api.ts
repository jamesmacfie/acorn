// Generating or editing a definition with AI (docs/workflows/ai-authoring.md § Generating and editing
// with AI): the wire types, and the one instruction cap both halves read.
//
// Shared because the modal's textarea and the route's Zod bound are the same number, and a number
// written twice drifts. The routes stay in ../client/workflowsClient.ts with the rest of this
// plugin's namespace.

import type { WorkflowDef, WorkflowInput } from './workflowContracts'

export type WorkflowTaskGroup = {
  rootTaskId: string
  descendants: number
  running: number
  attention: number
}

/** How much description or edit instruction the modal takes and the route accepts. Larger than the
 *  other generate budgets because this is the whole brief for a graph rather than a sentence about
 *  one query. A reader pasting an issue in is doing the right thing. */
export const GENERATE_MAX_DESCRIPTION_CHARS = 8_000

/** The body the generate route carries.
 *
 *  `backendId` and `modelId` are the pair every generate in the repo sends, so one picker serves
 *  them all. `workspaceId` is what the workspace's own definitions are read from, and
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
 *  behave like an overwrite. An overwrite carries only the name and inputs, as hints; it does not
 *  send the rest of the draft to the model. */
export type WorkflowGenerateRequest = WorkflowGenerateRequestBase &
  ({ mode: 'overwrite'; name?: string; inputs?: WorkflowInput[] } | { mode: 'edit'; currentDef: WorkflowDef })

/** Why the definition that came back is not the definition being applied.
 *
 *  The code is stable and a test asserts on it; the message is what the reader sees, and names the
 *  step and the offending value. One code per kind of correction `parseGeneratedWorkflow` and
 *  `groundWorkflow` make, so a note can be counted and grouped without reading English.
 *
 *  Parsing can drop invalid step entries or normalize equivalent map-source notation.
 *  Grounding never deletes a step. */
export type WorkflowGenerateNoteCode =
  | 'dropped-step'
  | 'normalized-map-source'
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
  | 'dropped-form'

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
