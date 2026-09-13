// The safety boundary around AI edits (docs/workflows.md § Generating and editing with AI).
//
// Edit mode has to show the model enough of the current definition to preserve it, without sending
// literal credentials or letting the model choose provider and execution configuration. This pure
// module owns both halves of that promise: the projection sent to the model, and the restoration
// applied after its answer has been grounded.

import type { ChildWorkflowConfig, WorkflowDef, WorkflowStepDef } from '../shared/workflowContracts'

type PromptWorkflowStep = Omit<WorkflowStepDef, 'childWorkflow'> & {
  childWorkflow?: Pick<ChildWorkflowConfig, 'inputs'>
}

/** The safe definition shape sent to a model. Protected child references are absent by type. */
export type PromptWorkflowDef = Omit<WorkflowDef, 'steps'> & { steps: PromptWorkflowStep[] }

// A contributed kind's `with` is where a literal credential plausibly sits, and neither key teaches
// anything about the shape of a graph.
const SCRUBBED_WITH_KEYS = ['headers', 'auth']

const toolsForPrompt = <T extends { allow?: unknown }>(tools: T | undefined): T | undefined => {
  if (!tools || !Object.hasOwn(tools, 'allow')) return tools
  const { allow: _allow, ...rest } = tools
  return Object.keys(rest).length ? rest as T : undefined
}

/** A definition as a model may see it: no credentials, provider choices, execution target, or
 *  loader bookkeeping. The same projection serves workspace examples and edit mode, so adding a
 *  protected field cannot make one path leak what the other withholds. */
export function definitionForPrompt(def: WorkflowDef): PromptWorkflowDef {
  const { id: _id, source: _source, ...rest } = def as WorkflowDef & { id?: unknown; source?: unknown }
  const { trigger: _trigger, ...visible } = rest
  const { tools: visibleTools, ...withoutTools } = visible
  const tools = toolsForPrompt(visibleTools)
  return {
    ...withoutTools,
    ...(tools ? { tools } : {}),
    steps: def.steps.map((step) => {
      const {
        model: _model,
        configOptions: _configOptions,
        requiresRun: _requiresRun,
        tools: hiddenTools,
        childStep: hiddenChild,
        childWorkflow: hiddenWorkflow,
        with: hiddenWith,
        ...safe
      } = step
      const stepTools = toolsForPrompt(hiddenTools)
      const child = hiddenChild
        ? (() => {
            const { model: _childModel, tools: childHiddenTools, ...childRest } = hiddenChild
            const childTools = toolsForPrompt(childHiddenTools)
            return { ...childRest, ...(childTools ? { tools: childTools } : {}) }
          })()
        : undefined
      const withFields = hiddenWith
        ? Object.fromEntries(Object.entries(hiddenWith).filter(([key]) => !SCRUBBED_WITH_KEYS.includes(key)))
        : undefined
      return {
        ...safe,
        ...(stepTools ? { tools: stepTools } : {}),
        ...(child ? { childStep: child } : {}),
        ...(hiddenWorkflow ? {
          childWorkflow: { inputs: hiddenWorkflow.inputs },
        } : {}),
        ...(withFields && Object.keys(withFields).length ? { with: withFields } : {}),
      }
    }),
  }
}

/** Finds one unambiguous same-name, same-kind predecessor. Duplicate names are invalid drafts, not
 *  identities that may receive two copies of the same protected authority. */
const protectedSourceFor = (
  current: WorkflowDef,
  changed: WorkflowDef,
  step: WorkflowStepDef,
): WorkflowStepDef | undefined => {
  const sameIdentity = (candidate: WorkflowStepDef) =>
    candidate.name === step.name && (candidate.kind ?? 'agent') === (step.kind ?? 'agent')
  const before = current.steps.filter(sameIdentity)
  return before.length === 1 && changed.steps.filter(sameIdentity).length === 1 ? before[0] : undefined
}

/** Restores only protected child targets before grounding, so bindings are checked against the
 *  target the edit keeps. The rest of the protected configuration is restored after grounding. */
export function restoreProtectedWorkflowTargets(current: WorkflowDef, changed: WorkflowDef): WorkflowDef {
  return {
    ...changed,
    steps: changed.steps.map((step) => {
      const before = protectedSourceFor(current, changed, step)
      if (!before?.childWorkflow) return step
      return {
        ...step,
        childWorkflow: {
          ...step.childWorkflow,
          ref: before.childWorkflow.ref,
        },
      }
    }),
  }
}

const restoreTools = <T extends { allow?: unknown }>(current: T | undefined, changed: T | undefined): T | undefined =>
  current && Object.hasOwn(current, 'allow') ? { ...changed, allow: current.allow } as T : changed

/** Put configuration hidden from the model back onto surviving steps.
 *
 *  Names and kinds are the identity boundary: deleting, renaming, or changing the kind of a step is
 *  an intentional structural edit, so old provider or credential configuration must not hitch a
 *  ride onto the new step. Everything else comes from the grounded model answer. */
export function restoreProtectedDefinition(current: WorkflowDef, changed: WorkflowDef): WorkflowDef {
  const steps = changed.steps.map((step): WorkflowStepDef => {
    const before = protectedSourceFor(current, changed, step)
    if (!before) return step

    let next: WorkflowStepDef = { ...step, tools: restoreTools(before.tools, step.tools) }
    for (const key of ['model', 'configOptions', 'requiresRun'] as const) {
      if (Object.hasOwn(before, key)) next = { ...next, [key]: before[key] }
    }
    if (before.childStep && next.childStep) {
      next = {
        ...next,
        childStep: {
          ...next.childStep,
          ...(Object.hasOwn(before.childStep, 'model') ? { model: before.childStep.model } : {}),
          tools: restoreTools(before.childStep.tools, next.childStep.tools),
        },
      }
    }
    if (before.childWorkflow) {
      next = {
        ...next,
        childWorkflow: {
          ...next.childWorkflow,
          ref: before.childWorkflow.ref,
        },
      }
    }
    const protectedWith = Object.fromEntries(
      SCRUBBED_WITH_KEYS.filter((key) => before.with && Object.hasOwn(before.with, key)).map((key) => [key, before.with![key]]),
    )
    if (Object.keys(protectedWith).length) next = { ...next, with: { ...next.with, ...protectedWith } }
    return next
  })
  return {
    ...changed,
    ...(Object.hasOwn(current, 'trigger') ? { trigger: current.trigger } : {}),
    tools: restoreTools(current.tools, changed.tools),
    steps,
  }
}
