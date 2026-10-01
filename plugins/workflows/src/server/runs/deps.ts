import type { HeadlessOpts, HeadlessResult, PluginHookRegistry, PluginTelemetry, StreamEvent } from '@acorn/plugin-api/node'
import type { ToolCeiling, WorkflowStepDef } from '../../shared/workflowContracts'
import type { WorkflowChildChangedEvent, WorkflowGateStatus, WorkflowRunStatus } from '../../contract/events'
import type { WorkflowDispatchRequest, WorkflowDispatchResult } from '../dispatch/dispatcher'

export type WorkflowChildTaskSeed = { title: string; branch: string; prompt?: string }
/** Material a step's prompt works on: an upstream step's output, or the task context. */
export type StepContextItem = { label: string; source: string; content: string }
/** The prompt with its context written into it, for a runner that takes one string, and for the step
 *  inputs the run pane shows. */
export const inlinePrompt = (prompt: string, context: readonly StepContextItem[] = []): string =>
  [prompt, ...context.map((item) => `## ${item.label}\n\n${item.content}`)].filter(Boolean).join('\n\n')
export type RunStepOptions = HeadlessOpts & {
  /** Sent after the prompt as separate context blocks, or inlined by a runner that has none. */
  context?: StepContextItem[]
  /** The resolved harness. The managed session and headless fallback use the same profile. */
  profileId: string
  mode?: 'headless' | 'ai'
  signal?: AbortSignal
  onEvent?: (event: StreamEvent) => void
  // A dispatched child becomes running only after it acquires an execution slot.
  onStart?: () => void | Promise<void>
  tools?: ToolCeiling
  workflowRunId?: string
  workflowStepId?: string
  managedSessionId?: string
  timeoutMs?: number
}

/** A handler leaves profile selection to workflow execution. */
export type StepRunRequest = Omit<RunStepOptions, 'profileId'>

export type RunnerDeps = {
  invalidStepKind?: (id: string, problems: readonly string[]) => void
  dataAccess?: import('../steps/data').WorkflowDataServices['access']
  runStep(taskId: string, def: WorkflowStepDef, opts: RunStepOptions): Promise<HeadlessResult>
  writeHandoff(taskId: string, runId: string, stepName: string, body: string): Promise<void>
  finishHandoffs?(taskId: string, runId: string): Promise<void>
  assembleContext(taskId: string, runId: string): Promise<string>
  evaluatePolicy(taskId: string, policy: string): Promise<{ pass: boolean; detail?: string }>
  failingChecks(taskId: string): Promise<string | null>
  // Every notification carries a run reference and, when applicable, a step reference.
  notify(taskId: string, kind: 'gate' | 'run-done' | 'run-failed', title: string, ref?: { runId: string; stepId?: string }): void
  /** A status edge for one step, used by the run pane. */
  stepChanged?(runId: string, stepId: string, status: string): void
  statusChanged?(): void
  /** A durable run-status edge. Per run, never per ordinary step. */
  runChanged?(taskId: string, runId: string, status: WorkflowRunStatus): void
  /** The human-approval reduction of step state. */
  gateChanged?(taskId: string, runId: string, stepId: string, status: WorkflowGateStatus): void
  emitStepEvent?(runId: string, stepId: string, event: StreamEvent): void
  onRunTerminal?(taskId: string, runId: string): Promise<void>
  startRunTarget?(taskId: string, targetId: string): Promise<{ ok: boolean; url?: string }>
  /** An absent `before-step` hook permits the step. */
  hooks?: Pick<PluginHookRegistry, 'run'>
  createChildTask?(parentTaskId: string, seed: WorkflowChildTaskSeed, intendedTaskId?: string): Promise<string>
  cancelChildTask?(taskId: string): Promise<void>
  cancelAgentSession?(taskId: string, sessionId: string): Promise<void>
  dispatchChildWorkflow?(request: WorkflowDispatchRequest, signal?: AbortSignal): Promise<WorkflowDispatchResult>
  dispatchChildWorkflows?(requests: readonly WorkflowDispatchRequest[], signal?: AbortSignal): Promise<WorkflowDispatchResult[]>
  selectWorkflowRecords?: import('../processing/store').WorkflowProcessingStore['dispatch']
  childChanged?(event: WorkflowChildChangedEvent): void
  authorizeRepoConfig?(taskId: string): Promise<void>
  /** Optional for tests that construct a runner without a host. */
  telemetry?: PluginTelemetry
}
