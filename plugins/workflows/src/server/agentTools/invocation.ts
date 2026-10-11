// Invocation policies (docs/agent-tools/workflow-tools.md § Invocation authority). Turning on
// `workflow_run` lets an agent use the verb; a policy says which executable graph it may start in
// which project, with which inputs and limits. Policies are written only through the device routes.
import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import type { PluginDatabase } from '@acorn/plugin-api/node'
import type { DataValue } from '@acorn/protocol/dataValues.ts'
import { workflowInvocationPolicies } from '../../node/schema'
import type { ResolvedWorkflowGraph, WorkflowDef } from '../../shared/workflowContracts'
import {
  DEFAULT_INVOCATION_STARTS,
  MAX_INVOCATION_STARTS,
  type WorkflowInvocationApproval,
  type WorkflowInvocationLimits,
  type WorkflowInvocationPolicy,
  type WorkflowInvocationReview,
} from '../../shared/workflowInvocation'
import { stepIdentity } from '../../shared/workflowIdentity'
import { workflowContentFingerprint } from '../definitions/fingerprint'
import type { WorkflowResolutionScope } from '../definitions/resolution'
import { resolveWorkflowInputs } from '../validation/definition'
import { executableDigest, refForKey, resolveRef, type WorkflowToolDeps } from './discovery'

type PolicyRow = typeof workflowInvocationPolicies.$inferSelect

export type PrepareInvocation = (
  target: { projectId: string } | { taskId: string },
  definitionId: string,
  inputs: Record<string, DataValue>,
  purpose: 'review' | 'start',
) => Promise<{ graph: ResolvedWorkflowGraph; scope: WorkflowResolutionScope }>

const DEFAULT_MAX_TURNS = 20
const DEFAULT_MAX_WALL_TIME_MS = 60 * 60 * 1000

/** `db:<id>` names a database row; `repo:` and `user:` keys are what the start service already takes. */
export const definitionIdForKey = (key: string): string => (key.startsWith('db:') ? key.slice(3) : key)

// What a person reads rather than what runs: workflow and step names, input and output labels and
// descriptions, and the root's input values, which differ per launch. Step names stay where a step
// has no ID, because then the name is its identity.
function executableShape(def: WorkflowDef, root: boolean): unknown {
  const { name: _name, inputs, outputs, steps, ...rest } = def
  return {
    ...rest,
    inputs: inputs?.map(({ label: _label, description: _description, default: value, required, ...input }) =>
      root ? input : { ...input, default: value, required },
    ),
    outputs: outputs?.map(({ label: _label, ...output }) => output),
    steps: steps.map(({ name, ...step }) => (step.id ? step : { name, ...step })),
  }
}

/** The digest an approval binds. Every node, its provenance and dependency revisions, and the child
 *  defaults are in it; labels and the caller's input values are not. */
export function executableGraphDigest(graph: ResolvedWorkflowGraph): string {
  return workflowContentFingerprint(
    graph.nodes.map((node, index) => ({
      path: node.path,
      provenance: node.provenance,
      defaultInputs: index === 0 ? null : node.defaultInputs,
      definition: executableShape(node.definition, index === 0),
    })),
  )
}

const INPUT_TOKEN = /\$\{inputs\.([A-Za-z][A-Za-z0-9_]*)\}/g

/** Root step fields an input reaches, by template or by binding. */
function inputUses(def: WorkflowDef): WorkflowInvocationReview['inputUses'] {
  const uses: WorkflowInvocationReview['inputUses'] = []
  const visit = (value: unknown, step: string, path: string[]) => {
    if (typeof value === 'string') {
      const names = [...new Set([...value.matchAll(INPUT_TOKEN)].map((match) => match[1]!))]
      if (names.length) uses.push({ step, field: path.join('.'), inputs: names })
      return
    }
    if (!value || typeof value !== 'object') return
    const address = (value as { address?: { from?: unknown; name?: unknown } }).address
    if (address?.from === 'input' && typeof address.name === 'string') {
      uses.push({ step, field: path.join('.'), inputs: [address.name] })
      return
    }
    for (const [key, item] of Object.entries(value)) visit(item, step, [...path, key])
  }
  for (const step of def.steps) visit(step, stepIdentity(step), [])
  return uses
}

const view = (row: PolicyRow): WorkflowInvocationPolicy => ({
  id: row.id,
  projectId: row.projectId,
  definitionKey: row.definitionKey,
  state: row.state as WorkflowInvocationPolicy['state'],
  graphDigest: row.graphDigest,
  definitionDigest: row.definitionDigest,
  callerInputs: JSON.parse(row.callerInputsJson) as string[],
  fixedInputs: JSON.parse(row.fixedInputsJson) as Record<string, DataValue>,
  limits: JSON.parse(row.limitsJson) as WorkflowInvocationLimits,
  startsPerSession: row.startsPerSession,
  updatedAt: row.updatedAt,
})

const positive = (value: number | undefined, integer: boolean): boolean =>
  value === undefined || (Number.isFinite(value) && value > 0 && (!integer || Number.isSafeInteger(value)))

function approvalProblems(approval: WorkflowInvocationApproval, root: WorkflowDef): string[] {
  const problems: string[] = []
  const declared = new Set((root.inputs ?? []).map((input) => input.name))
  for (const name of [...approval.callerInputs, ...Object.keys(approval.fixedInputs)]) {
    if (!declared.has(name)) problems.push(`The workflow has no input '${name}'.`)
  }
  for (const name of approval.callerInputs) {
    if (Object.hasOwn(approval.fixedInputs, name))
      problems.push(`Input '${name}' cannot be both fixed and set by the agent.`)
  }
  const { limits } = approval
  if (!positive(limits.maxTurns, true) || limits.maxTurns === undefined) problems.push('Set a maximum number of turns.')
  if (!positive(limits.maxWallTimeMs, true) || limits.maxWallTimeMs === undefined)
    problems.push('Set a maximum run time.')
  if (
    !positive(limits.maxCostUsd, false) ||
    !positive(limits.maxInputTokens, true) ||
    !positive(limits.maxOutputTokens, true)
  ) {
    problems.push('Cost and token limits must be positive numbers.')
  }
  if (
    !Number.isSafeInteger(approval.startsPerSession) ||
    approval.startsPerSession < 1 ||
    approval.startsPerSession > MAX_INVOCATION_STARTS
  ) {
    problems.push(`Starts per agent session must be from 1 to ${MAX_INVOCATION_STARTS}.`)
  }
  return problems
}

export type WorkflowInvocationDeps = WorkflowToolDeps & {
  prepare: PrepareInvocation
  audit(action: string, entry: { subject: string; details: Record<string, string | number | boolean | null> }): void
}

export class WorkflowInvocationPolicies {
  private readonly db: PluginDatabase

  constructor(private readonly deps: WorkflowInvocationDeps) {
    this.db = deps.db
  }

  /** The executable digest the agent read, for the definition this key names in this scope. */
  async definitionDigest(scope: WorkflowResolutionScope, definitionKey: string): Promise<string> {
    const ref = refForKey(definitionKey)
    const digest = ref ? executableDigest(await resolveRef(this.deps, scope, ref)) : undefined
    if (!digest) throw new Error('This workflow is not published.')
    return digest
  }

  find(projectId: string, definitionKey: string): WorkflowInvocationPolicy | null {
    const row = this.db
      .select()
      .from(workflowInvocationPolicies)
      .where(
        and(
          eq(workflowInvocationPolicies.projectId, projectId),
          eq(workflowInvocationPolicies.definitionKey, definitionKey),
        ),
      )
      .get()
    return row ? view(row) : null
  }

  byId(id: string): WorkflowInvocationPolicy | null {
    const row = this.db.select().from(workflowInvocationPolicies).where(eq(workflowInvocationPolicies.id, id)).get()
    return row ? view(row) : null
  }

  async review(projectId: string, definitionKey: string): Promise<WorkflowInvocationReview> {
    const { graph, scope } = await this.deps.prepare({ projectId }, definitionIdForKey(definitionKey), {}, 'review')
    const policy = this.find(projectId, definitionKey)
    const graphDigest = executableGraphDigest(graph)
    const budget = graph.root.budget
    return {
      definitionKey,
      workflowName: graph.root.name,
      definitionDigest: await this.definitionDigest(scope, definitionKey),
      graphDigest,
      posture: graph.root.posture ?? 'gated',
      nodes: graph.nodes.map((node) => ({
        path: node.path,
        name: node.definition.name,
        provenance: node.provenance,
        steps: node.definition.steps.map((step) => ({
          id: stepIdentity(step),
          name: step.name,
          kind: step.kind ?? 'agent',
          ...(step.profileId ? { profileId: step.profileId } : {}),
          ...(step.model ? { model: step.model } : {}),
          ...(step.configOptions ? { configOptions: step.configOptions } : {}),
        })),
      })),
      inputs: (graph.root.inputs ?? []).map(({ default: value, ...input }) => ({
        ...input,
        hasDefault: value !== undefined,
      })),
      inputUses: inputUses(graph.root),
      defaults: {
        limits: {
          maxTurns: budget?.maxTurns ?? DEFAULT_MAX_TURNS,
          maxWallTimeMs: budget?.maxWallTimeMs ?? DEFAULT_MAX_WALL_TIME_MS,
          ...(budget?.maxCostUsd ? { maxCostUsd: budget.maxCostUsd } : {}),
        },
        startsPerSession: DEFAULT_INVOCATION_STARTS,
      },
      policy,
      changed: !!policy && policy.state === 'active' && policy.graphDigest !== graphDigest,
    }
  }

  async approve(approval: WorkflowInvocationApproval): Promise<WorkflowInvocationPolicy> {
    const { graph, scope } = await this.deps.prepare(
      { projectId: approval.projectId },
      definitionIdForKey(approval.definitionKey),
      {},
      'review',
    )
    const graphDigest = executableGraphDigest(graph)
    if (graphDigest !== approval.graphDigest)
      throw new Error('The workflow changed while you were reviewing it. Review it again.')
    const problems = approvalProblems(approval, graph.root)
    if (problems.length) throw new Error(problems.join(' '))
    // Fixed values are checked against the input schemas now, so a bad one fails here and not at
    // every launch. Inputs left to the definition keep their defaults.
    const relaxed = { ...graph.root, inputs: graph.root.inputs?.map((input) => ({ ...input, required: false })) }
    resolveWorkflowInputs(relaxed, approval.fixedInputs)
    const at = Date.now()
    const existing = this.find(approval.projectId, approval.definitionKey)
    const values = {
      workspaceId: scope.workspaceId,
      definitionDigest: await this.definitionDigest(scope, approval.definitionKey),
      graphDigest,
      dependenciesJson: JSON.stringify(graph.nodes.map((node) => ({ path: node.path, provenance: node.provenance }))),
      callerInputsJson: JSON.stringify([...new Set(approval.callerInputs)].sort()),
      fixedInputsJson: JSON.stringify(approval.fixedInputs),
      limitsJson: JSON.stringify(approval.limits),
      startsPerSession: approval.startsPerSession,
      state: 'active',
      updatedAt: at,
    }
    // Replacing a grant updates the same row, so the starts a session spent against it stay spent.
    if (existing)
      this.db.update(workflowInvocationPolicies).set(values).where(eq(workflowInvocationPolicies.id, existing.id)).run()
    else
      this.db
        .insert(workflowInvocationPolicies)
        .values({
          id: randomUUID(),
          projectId: approval.projectId,
          definitionKey: approval.definitionKey,
          createdAt: at,
          ...values,
        })
        .run()
    const policy = this.find(approval.projectId, approval.definitionKey)!
    this.deps.audit('agent-invocation-approved', {
      subject: policy.id,
      details: {
        projectId: policy.projectId,
        definition: policy.definitionKey,
        graphDigest,
        startsPerSession: policy.startsPerSession,
      },
    })
    return policy
  }

  /** Blocks fresh starts. Admitted runs keep the authority they were admitted with. */
  revoke(projectId: string, definitionKey: string): WorkflowInvocationPolicy | null {
    const existing = this.find(projectId, definitionKey)
    if (!existing || existing.state === 'revoked') return existing
    this.db
      .update(workflowInvocationPolicies)
      .set({ state: 'revoked', updatedAt: Date.now() })
      .where(eq(workflowInvocationPolicies.id, existing.id))
      .run()
    this.deps.audit('agent-invocation-revoked', {
      subject: existing.id,
      details: { projectId, definition: definitionKey },
    })
    return this.find(projectId, definitionKey)
  }
}
