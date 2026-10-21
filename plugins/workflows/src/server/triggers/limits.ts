import type { ResolvedWorkflowGraph, WorkflowBudget } from '../../shared/workflowContracts'
import type { WorkflowTriggerDraftInput, WorkflowTriggerLimits } from '../../shared/workflowTriggers'
import { workflowContentFingerprint } from '../definitions/fingerprint'

export const DEFAULT_TRIGGER_WALL_TIME_MS = 24 * 60 * 60 * 1000

/** The limits a trigger's runs get: what the owner asked for, never wider than the workflow allows. */
export function effectiveTriggerLimits(
  graph: ResolvedWorkflowGraph,
  requested?: WorkflowTriggerDraftInput['limits'],
): WorkflowTriggerLimits {
  const root = graph.root
  const maxDescendants = requested?.maxDescendants ?? root.maxDescendants ?? 100
  const maxConcurrency = requested?.maxConcurrency ?? root.maxConcurrency ?? 4
  const requestedBudget: WorkflowBudget = requested?.budget ?? {}
  const maxWallTimeMs = requestedBudget.maxWallTimeMs ?? root.budget?.maxWallTimeMs ?? DEFAULT_TRIGGER_WALL_TIME_MS
  if (
    !Number.isSafeInteger(maxDescendants) ||
    maxDescendants < 1 ||
    maxDescendants > Math.min(root.maxDescendants ?? 500, 500)
  ) {
    throw new Error("A trigger's max descendants must be from 1 to the workflow ceiling.")
  }
  if (
    !Number.isSafeInteger(maxConcurrency) ||
    maxConcurrency < 1 ||
    maxConcurrency > Math.min(root.maxConcurrency ?? 4, 4)
  ) {
    throw new Error("A trigger's concurrency must be from 1 to the workflow ceiling.")
  }
  if (
    !Number.isFinite(maxWallTimeMs) ||
    maxWallTimeMs <= 0 ||
    (root.budget?.maxWallTimeMs != null && maxWallTimeMs > root.budget.maxWallTimeMs)
  ) {
    throw new Error("A trigger's wall time must be finite and no wider than the workflow budget.")
  }
  for (const field of ['maxCostUsd', 'maxInputTokens', 'maxOutputTokens', 'maxTurns'] as const) {
    const value = requestedBudget[field]
    const ceiling = root.budget?.[field]
    if (value != null && (!Number.isFinite(value) || value < 0 || (ceiling != null && value > ceiling))) {
      throw new Error(`A trigger's ${field} must be finite and no wider than the workflow budget.`)
    }
  }
  return {
    maxDescendants,
    maxConcurrency,
    budget: { ...root.budget, ...requestedBudget, maxWallTimeMs },
    allowUnguardedAgents: requested?.allowUnguardedAgents === true,
  }
}

/** Writes the limits onto the root, so the approval digest covers them. */
export function applyTriggerLimits(graph: ResolvedWorkflowGraph, limits: WorkflowTriggerLimits): ResolvedWorkflowGraph {
  const root = {
    ...graph.root,
    maxDescendants: limits.maxDescendants,
    maxConcurrency: limits.maxConcurrency,
    budget: limits.budget,
  }
  const nodes = graph.nodes.map((node, index) => (index === 0 ? { ...node, definition: root } : node))
  return {
    ...graph,
    root,
    nodes,
    fingerprint: workflowContentFingerprint(
      nodes.map(({ path, definition, provenance, defaultInputs }) => ({ path, definition, provenance, defaultInputs })),
    ),
  }
}
