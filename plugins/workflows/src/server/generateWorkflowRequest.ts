// The two calls behind Generate in the workflow editor (docs/workflows.md § Authoring): ask, read
// the answer, and give the model one chance to fix what the checker found.
//
// The only impure thing here is the injected `generateText`, which is `core.models.generateText`
// with the owner already bound. Everything it depends on — the prompt in ./generateWorkflow.ts, the
// reader in ./groundWorkflow.ts, the checker in ./workflowValidation.ts — is pure, so this file is
// testable against a fake and never needs a provider.
//
// Two rules are load-bearing.
//
// The repair call resends the system prompt byte for byte and changes only the user prompt. That is
// a cache hit at any provider that keys on a prefix, and it keeps the model from being re-taught
// what a workflow is halfway through a conversation it does not remember having.
//
// The repair answer wins when it parses and has a step, and never on a problem count. The cheapest
// way for a model to shorten a problem list is to delete the steps that carry the problems, so
// "fewer problems" would sometimes hand back a three-step version of an eight-step workflow. A
// problem count is not a quality measure.
//
// When the repair answer wins, its notes are the whole list. The first pass's notes describe a
// definition that was discarded, and a reader has no way to tell them apart from the ones about the
// draft in front of them.
//
// There is never a third call. A first answer that is not JSON at all has nothing to repair — the
// repair prompt is built from a grounded definition and the checker's messages, and neither exists —
// so it returns the parse error for the route to answer 422 with.
import type { WorkflowGenerateNote, WorkflowGenerateRequest, WorkflowGenerateResult } from '../shared/api'
import type { WorkflowCatalog, WorkflowDef } from '../shared/workflowContracts'
import {
  buildGenerateSystemPrompt,
  buildGenerateUserPrompt,
  buildRepairUserPrompt,
  GENERATE_MAX_OUTPUT_TOKENS,
  type WorkflowExample,
} from './generateWorkflow'
import { groundWorkflow, parseGeneratedWorkflow } from './groundWorkflow'
import { validateWorkflow, type WorkflowValidationCatalog } from './workflowValidation'

/** As much of `core.models.generateText` as this needs, with the owner bound by the caller.
 *
 *  Narrower than the core seam on purpose: a test fakes this in one line, and nothing here should be
 *  able to reach a user id or a secret. */
export type GenerateWorkflowText = (args: {
  connectionId: string
  input: { system: string; prompt: string; modelId?: string; maxOutputTokens: number }
}) => Promise<{ text: string; providerId: string; modelId: string }>

export type GenerateWorkflowArgs = {
  request: WorkflowGenerateRequest
  catalog: WorkflowCatalog
  // The runner's own catalog, not the pure default. Without the per-kind validators a workspace
  // example with a broken `join` passes the example filter and teaches the model the mistake.
  validation: WorkflowValidationCatalog
  examples?: readonly WorkflowExample[]
  generateText: GenerateWorkflowText
}

type Answer = { def: WorkflowDef; notes: WorkflowGenerateNote[]; problems: string[] }

/** Strip, extract, parse, ground, validate — the fixed pipeline, run over one reply.
 *
 *  Parsing and grounding each report their own changes, and the reader wants one list, so the two
 *  are concatenated here rather than at every call site. */
function readAnswer(text: string, catalog: WorkflowCatalog, validation: WorkflowValidationCatalog): Answer | { error: string } {
  const parsed = parseGeneratedWorkflow(text)
  if ('error' in parsed) return parsed
  const grounded = groundWorkflow(parsed.def, catalog)
  return {
    def: grounded.def,
    notes: [...parsed.notes, ...grounded.notes],
    problems: validateWorkflow(grounded.def, validation),
  }
}

/**
 * The definition to apply, or the reason there is none.
 *
 * One call when the first answer passes the checker, which is the common case and half the latency.
 * Two when it does not. Never more.
 */
export async function generateWorkflowRequest(args: GenerateWorkflowArgs): Promise<WorkflowGenerateResult | { error: string }> {
  const { catalog, request, validation } = args
  const system = buildGenerateSystemPrompt({
    catalog,
    validation,
    ...(args.examples ? { examples: args.examples } : {}),
    ...(request.defId ? { excludeId: request.defId } : {}),
  })
  const userPrompt = buildGenerateUserPrompt(request)
  const ask = (prompt: string) =>
    args.generateText({
      connectionId: request.connectionId,
      input: { system, prompt, ...(request.modelId ? { modelId: request.modelId } : {}), maxOutputTokens: GENERATE_MAX_OUTPUT_TOKENS },
    })

  const first = await ask(userPrompt)
  const answer = readAnswer(first.text, catalog, validation)
  if ('error' in answer) return answer
  const kept = { ...answer, repaired: false, providerId: first.providerId, modelId: first.modelId }
  if (!answer.problems.length) return kept

  const second = await ask(buildRepairUserPrompt({ userPrompt, def: answer.def, notes: answer.notes, problems: answer.problems }))
  const repair = readAnswer(second.text, catalog, validation)
  if ('error' in repair) return kept
  // The repair pass's notes alone. A note describes a change made to the reply it came in, and this
  // reply was read through the same pipeline, so anything the model put back is reported again and
  // anything it did not is a change to a definition nobody will ever see. Carrying both lists tells
  // the reader a kind was dropped from a draft that was thrown away.
  return {
    def: repair.def,
    notes: repair.notes,
    problems: repair.problems,
    repaired: true,
    providerId: second.providerId,
    modelId: second.modelId,
  }
}
