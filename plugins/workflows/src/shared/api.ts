// Generating a definition from a description (docs/workflows.md § Authoring): the wire types, and
// the one cap both halves read.
//
// Here rather than beside the prompt for the reason the changes plugin keeps
// `COMMIT_MESSAGE_MAX_PROMPT_CHARS` in its own `shared/api.ts`: the modal's textarea and the route's
// Zod bound are the same number, and a number written twice is a number that drifts. The routes
// themselves stay in ../client/workflowsClient.ts with the rest of this plugin's namespace.

import type { WorkflowDef, WorkflowInput } from './workflowContracts'

/** How much description the modal takes and the route accepts.
 *
 *  Twice the changes plugin's diff budget and eight times the database plugin's prompt budget,
 *  because this one is the whole brief for a graph rather than a sentence about one query. A reader
 *  pasting an issue in is doing the right thing. */
export const GENERATE_MAX_DESCRIPTION_CHARS = 8_000

/** The body the generate route carries.
 *
 *  `connectionId` and `modelId` are the pair every generate in the repo sends, so the same picker
 *  serves all three. `workspaceId` is what the workspace's own definitions are read from, and
 *  `defId` is the one they are read without: a definition is a poor worked example of itself.
 *  `name` and `inputs` are the draft being replaced, which the model is told to keep where they
 *  still fit. */
export type WorkflowGenerateRequest = {
  connectionId: string
  modelId?: string
  description: string
  workspaceId: string
  defId?: string
  name?: string
  inputs?: WorkflowInput[]
}

/** Why the definition that came back is not the definition being applied.
 *
 *  The code is stable and a test asserts on it; the message is what the reader sees, and names the
 *  step and the offending value. One code per row of the grounding table
 *  (../server/groundWorkflow.ts), so a note can be counted and grouped without reading English. */
export type WorkflowGenerateNoteCode =
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
