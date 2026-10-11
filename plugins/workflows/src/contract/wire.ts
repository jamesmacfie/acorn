import type { ACORN_BASELINE } from '@acorn/protocol/baseline.ts'
import type { DataValue } from '@acorn/protocol/dataValues.ts'
import type { DataSchema } from '@acorn/protocol/dataSchemas.ts'

// These mirror the persisted rows (`workflowContracts` in shared/ derives its own from the schema) but
// are declared structurally so a client never imports a node-side module. The agents and terminal
// plugins read them too.

// A committed/user workflow definition as loadWorkflowFiles returns it (docs/workflows.md): what the
// palette launches and the settings inspector lists. `source` is the layer it was found in.
export type WorkflowDefSummary = {
  baseline: typeof ACORN_BASELINE
  publishedRevision?: number | null
  maxDescendants?: number
  maxConcurrency?: number
  formatVersion: 1
  id: string
  name: string
  // 'database' is a row the owner typed in the app rather than a file somebody committed
  // (docs/workflows/definitions.md § Database definitions). The three layers are read as one list and a repo id
  // wins a collision.
  source: 'repo' | 'user' | 'database'
  posture?: 'gated' | 'autonomous'
  inputs?: WorkflowInput[]
  steps: {
    id?: string
    name: string
    kind?: string
    after?: string[]
    isolation?: 'shared' | 'worktree'
    inputs?: 'append' | 'template' | 'none'
  }[]
  // The project this definition belongs to: the one whose checkout holds the file, or the one a row
  // is bound to. Null on a row that any project in the workspace may run.
  projectId?: string | null
  // Why this one cannot be run as it stands, when the merged read already knows.
  problems?: string[]
  // True for a draft an agent created through `workflow_draft`, so the list can mark it.
  agentAuthored?: boolean
}

// Where an agent-authored draft came from (docs/agent-tools/workflow-tools.md § Drafts). Recorded when
// the draft is created and shown in the editor beside it. The session is the signed caller identity,
// not anything the agent typed, and the draft text stays untrusted whatever this says.
export type WorkflowAgentOrigin = {
  taskId: string
  sessionId: string
  /** The `workflow_draft` call that created the draft, and the last one that saved it. */
  callId: string
  lastCallId: string
  /** The definition this draft proposes changes to, and its revision or digest at the time. */
  source?: { source: 'database'; id: string } | { source: 'repo'; path: string } | { source: 'user'; id: string }
  baseRevision?: number
  baseDigest?: string
  createdAt: number
}

// A definition stored as a row (docs/workflows/definitions.md § Database definitions). `def` is the plugin's own
// `WorkflowDef`; it is `unknown` here because that shape lives in plugins/workflows and protocol may
// not depend on a plugin. The editor narrows it there.
export type WorkflowDefRow = {
  publishedRevision?: number | null
  basePublishedRevision?: number | null
  id: string
  workspaceId: string
  projectId: string | null
  name: string
  revision: number
  createdAt: number
  updatedAt: number
  def: unknown
  /** The immutable revision Run will start. Omitted when this draft has never been published. */
  publishedDef?: unknown
  /** Present only on a draft an agent created. */
  agentOrigin?: WorkflowAgentOrigin | null
}

// A value a run is started with. The palette asks for one before it starts a definition that declares
// any, and the editor lists them (docs/workflows/execution.md § Execution model).
export type WorkflowInput = {
  connection?: { source: import('@acorn/protocol/dataSources.ts').DataSourceRef }
  name: string
  label?: string
  schema?: DataSchema
  description?: string
  required?: boolean
  default?: DataValue
}

export type WorkflowRunRow = {
  id: string
  taskId: string
  name: string
  status:
    | 'running'
    | 'gated'
    | 'cancelling'
    | 'done'
    | 'completed-with-failures'
    | 'failed'
    | 'safety-rail'
    | 'cancelled'
  posture: string
  error: string | null
  createdAt: number
  updatedAt: number
  // The definition this run froze at start, as JSON. The run pane draws its nodes in graph order, and
  // only the definition knows what each step waits on.
  defJson?: string
}

export type WorkflowStepRow = {
  id: string
  runId: string
  idx: number
  name: string
  kind: string
  mode: string
  profileId: string | null
  model: string | null
  status:
    | 'pending'
    | 'running'
    | 'waiting-gate'
    | 'waiting-children'
    | 'done'
    | 'completed-with-failures'
    | 'failed'
    | 'skipped'
    | 'safety-rail'
    | 'cancelled'
  resultJson: string | null
  structuredJson: string | null
  sessionId: string | null
  agentSessionId: string | null
  costUsd: number | null
  iteration: number
  error: string | null
  createdAt: number
  updatedAt: number
  resumeCommand?: string | null
  // The bundle handed to the step: the rendered prompt, and `childTaskId` for a step the runner gave
  // its own task and checkout. The run pane reads the second to link to that task.
  inputsJson?: string | null
  // An agent step's completion condition state (`AgentExecuteGoalSummary` in the agents contract).
  // Host metadata: no binding reads it.
  goalJson?: string | null
  // Which dispatch step spawned this one, when one did. The run pane draws a child under its parent.
  parentStepId?: string | null
}
