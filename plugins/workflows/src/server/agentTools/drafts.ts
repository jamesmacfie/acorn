// `workflow_draft` (docs/agent-tools/workflow-tools.md § Drafts): an agent saves a project-scoped
// database draft for the owner to review. A draft never runs; publication stays an owner action in
// the editor, and nothing here touches a published revision.
//
// Replay. Each call is keyed by task, signed session, and the MCP proxy's stable call ID. The answer is
// computed and stored as `reserved` before the write, and the write stamps the call ID onto the draft
// in the same statement. A repeated call returns the stored answer; one that finds `reserved` checks
// the draft for its own stamp to learn whether the write landed before a crash or a lost response.
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { ToolError, type ToolContext } from '@acorn/plugin-api/node'
import type { WorkflowAgentOrigin } from '../../contract/wire.ts'
import { workflowToolCalls } from '../../node/schema'
import type { WorkflowDef, WorkflowDefinitionRef } from '../../shared/workflowContracts'
import type { WorkflowDraftWriter } from '../definitions/activation'
import { workflowContentFingerprint } from '../definitions/fingerprint'
import type { WorkflowTaskResolutionScope } from '../definitions/resolution'
import { getDef, type StoredWorkflowDef } from '../definitions/store'
import { validateWorkflow } from '../validation/definition'
import { requireManagedCaller, type CallerLookup } from './caller'
import { workflowSemanticDiff, type WorkflowSemanticDiff } from './diff'
import {
  definitionTarget,
  requireTaskScope,
  resolveRef,
  sameScope,
  scopedValidation,
  structuralProblems,
  type WorkflowDefinitionTarget,
  type WorkflowToolDeps,
} from './discovery'
import { agentDefinitionView, agentDraftDefinition, type WithheldField } from './projection'

export type WorkflowDraftInput = {
  definition: Record<string, unknown>
  draftId?: string
  expectedRevision?: number
  source?: WorkflowDefinitionRef
}

export type WorkflowDraftResult = {
  id: string
  ref: { source: 'database'; id: string }
  revision: number
  digest: string
  created: boolean
  source?: WorkflowDefinitionRef
  diff: WorkflowSemanticDiff
  problems: string[]
  withheld: WithheldField[]
  target: WorkflowDefinitionTarget
}

export type WorkflowDraftDeps = WorkflowToolDeps & {
  writer: WorkflowDraftWriter
  caller: CallerLookup
  audit(action: string, entry: { subject: string; details: Record<string, string | number | boolean | null> }): void
}

// One save, worked out before anything is written.
type Plan = { result: WorkflowDraftResult; write(): Promise<void> }
type Caller = { taskId: string; sessionId: string; callId: string }

const conflict = (row: StoredWorkflowDef): ToolError =>
  new ToolError(
    'conflict',
    `The draft changed: revision ${row.revision} is current. Read it with workflow_get, then save against revision ${row.revision}.`,
  )

export class WorkflowAgentDrafts {
  // Concurrent repeats of one call share its promise, so a transport retry cannot race the original.
  private readonly inFlight = new Map<string, Promise<WorkflowDraftResult>>()

  constructor(private readonly deps: WorkflowDraftDeps) {}

  async save(input: WorkflowDraftInput, context: ToolContext): Promise<WorkflowDraftResult> {
    const signed = await requireManagedCaller(this.deps.caller, context)
    if (!context.callId) throw new ToolError('bad_request', 'workflow_draft needs a stable tool call ID.')
    const caller = { taskId: context.taskId, sessionId: signed.sessionId, callId: context.callId }
    const key = `${caller.taskId}:${caller.sessionId}:workflow_draft:${caller.callId}`
    const running = this.inFlight.get(key)
    if (running) return running
    const operation = this.saveOnce(key, input, caller)
    this.inFlight.set(key, operation)
    void operation.finally(() => this.inFlight.delete(key)).catch(() => undefined)
    return operation
  }

  private async saveOnce(key: string, input: WorkflowDraftInput, caller: Caller): Promise<WorkflowDraftResult> {
    const db = this.deps.db
    const fingerprint = workflowContentFingerprint(input)
    const prior = db.select().from(workflowToolCalls).where(eq(workflowToolCalls.key, key)).get()
    if (prior) {
      if (prior.fingerprint !== fingerprint)
        throw new ToolError('conflict', 'This tool call ID was already used with a different draft.')
      if (prior.state === 'done' || (await getDef(db, prior.definitionId))?.agentOrigin?.lastCallId === caller.callId) {
        db.update(workflowToolCalls).set({ state: 'done' }).where(eq(workflowToolCalls.key, key)).run()
        return JSON.parse(prior.resultJson) as WorkflowDraftResult
      }
      // Reserved and never written, so nothing happened. Plan it again against what is there now.
      db.delete(workflowToolCalls).where(eq(workflowToolCalls.key, key)).run()
    }

    const problems = structuralProblems(input.definition)
    if (problems.length) throw new ToolError('bad_request', problems.join('\n'))
    const scope = await requireTaskScope(this.deps, caller.taskId)
    const plan = input.draftId
      ? await this.planReplace(input, scope, caller)
      : await this.planCreate(input, scope, caller)

    db.insert(workflowToolCalls)
      .values({
        key,
        tool: 'workflow_draft',
        sessionId: caller.sessionId,
        fingerprint,
        definitionId: plan.result.id,
        state: 'reserved',
        resultJson: JSON.stringify(plan.result),
        createdAt: Date.now(),
      })
      .run()
    try {
      await plan.write()
    } catch (error) {
      db.delete(workflowToolCalls).where(eq(workflowToolCalls.key, key)).run()
      throw error
    }
    db.update(workflowToolCalls).set({ state: 'done' }).where(eq(workflowToolCalls.key, key)).run()
    this.deps.audit('agent-draft-saved', {
      subject: plan.result.id,
      details: {
        taskId: caller.taskId,
        sessionId: caller.sessionId,
        revision: plan.result.revision,
        created: plan.result.created,
      },
    })
    return plan.result
  }

  private async planCreate(
    input: WorkflowDraftInput,
    scope: WorkflowTaskResolutionScope,
    caller: Caller,
  ): Promise<Plan> {
    let base: WorkflowDef | null = null
    let basis: Pick<WorkflowAgentOrigin, 'source' | 'baseRevision' | 'baseDigest'> = {}
    if (input.source) {
      const entry = await resolveRef(this.deps, scope, input.source)
      base = entry.row?.def ?? entry.file ?? null
      if (!base)
        throw new ToolError(
          'bad_request',
          `The source workflow could not be read: ${(entry.loadErrors ?? []).join('; ')}`,
        )
      basis = {
        source: input.source,
        ...(entry.row ? { baseRevision: entry.row.revision } : {}),
        baseDigest: workflowContentFingerprint(base),
      }
    }
    const id = randomUUID()
    const def = agentDraftDefinition(input.definition as unknown as WorkflowDef, base)
    const agentOrigin: WorkflowAgentOrigin = {
      taskId: caller.taskId,
      sessionId: caller.sessionId,
      callId: caller.callId,
      lastCallId: caller.callId,
      ...basis,
      createdAt: Date.now(),
    }
    return {
      result: await this.result(scope, { id, revision: 1, def, before: base, created: true, source: input.source }),
      write: async () => {
        await this.deps.writer.create({
          id,
          workspaceId: scope.workspaceId,
          projectId: scope.projectId,
          def,
          agentOrigin,
        })
      },
    }
  }

  private async planReplace(
    input: WorkflowDraftInput,
    scope: WorkflowTaskResolutionScope,
    caller: Caller,
  ): Promise<Plan> {
    if (input.source)
      throw new ToolError(
        'bad_request',
        'Pass draftId to replace your draft, or source to propose a new one, not both.',
      )
    if (input.expectedRevision === undefined)
      throw new ToolError('bad_request', 'expectedRevision is required with draftId. Read it with workflow_get.')
    const row = await getDef(this.deps.db, input.draftId!)
    // Only the session that created a draft replaces it. Anyone else's draft, the owner's included,
    // answers as missing; the agent can still propose a copy with `source`.
    if (
      !row ||
      !sameScope(row, scope) ||
      row.agentOrigin?.sessionId !== caller.sessionId ||
      row.agentOrigin.taskId !== caller.taskId
    ) {
      throw new ToolError(
        'not_found',
        'No draft this session created has that ID. To propose changes to another workflow, pass it as source.',
      )
    }
    if (row.revision !== input.expectedRevision) throw conflict(row)
    // The current draft, owner edits included, is what withheld values come back from.
    const def = agentDraftDefinition(input.definition as unknown as WorkflowDef, row.def)
    const expected = input.expectedRevision
    return {
      result: await this.result(scope, {
        id: row.id,
        revision: expected + 1,
        def,
        before: row.def,
        created: false,
        source: row.agentOrigin.source,
      }),
      write: async () => {
        const answer = await this.deps.writer.update(row.id, def, expected, caller.callId)
        if (!answer) throw new ToolError('not_found', 'That draft was deleted.')
        if ('conflict' in answer) throw conflict(answer.conflict)
      },
    }
  }

  private async result(
    scope: WorkflowTaskResolutionScope,
    saved: {
      id: string
      revision: number
      def: WorkflowDef
      before: WorkflowDef | null
      created: boolean
      source?: WorkflowDefinitionRef
    },
  ): Promise<WorkflowDraftResult> {
    const ref = { source: 'database' as const, id: saved.id }
    return {
      id: saved.id,
      ref,
      revision: saved.revision,
      digest: workflowContentFingerprint(saved.def),
      created: saved.created,
      ...(saved.source ? { source: saved.source } : {}),
      diff: workflowSemanticDiff(saved.before, saved.def),
      // Incomplete drafts are kept with their problems, as the editor keeps them.
      problems: validateWorkflow(saved.def, await scopedValidation(this.deps, scope)),
      withheld: agentDefinitionView(saved.def).withheld,
      target: definitionTarget(ref, scope),
    }
  }
}
