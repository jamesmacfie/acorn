// What an item from another tool fills in when a workflow starts from it, and the person's answers
// parsed the way the run route expects (docs/workflows/starting-runs.md § Starting a run). The
// desktop's "Start workflow…" box and the browser extension's handoff card both use these, so an item
// fills the same inputs wherever the run starts.
import type { DataValue } from '@acorn/protocol/dataValues.ts'
import { validateDataValue } from '@acorn/protocol/dataSchemas.ts'
import type { WorkflowInput } from './wire.ts'

/**
 * What an item fills in, keyed by input name.
 *
 * By name rather than by declaration order or by a mapping each integration writes, so a definition
 * that says `inputs = [{ name = "issue" }]` works from every tracker and a new one gets the rule for
 * free. `issue`, `item` and `context` get the title and the body one blank line apart, and `link` or
 * `url` gets somewhere to read it. Every other name is left for the person, because guessing at
 * `focus` or `depth` from an error title puts words in a prompt nobody chose. The names are exact: a
 * definition that spells one `Issue` fills it in itself.
 */
export function prefillFromItem(item: { title?: string; body?: string; link?: string }): Record<string, string> {
  const both = [item.title, item.body].filter((part) => part?.trim()).join('\n\n')
  return {
    ...(both ? { issue: both, item: both, context: both } : {}),
    ...(item.link ? { link: item.link, url: item.link } : {}),
  }
}

/** Parse the answers exactly as the run route expects; the item remains a source of defaults. */
export function collectItemWorkflowInputs(
  inputs: readonly WorkflowInput[],
  valueOf: (name: string) => string,
): Record<string, DataValue> {
  return Object.fromEntries(
    inputs.flatMap((input) => {
      const raw = valueOf(input.name)
      if (raw === '') return []
      const value = !input.schema || input.schema.type === 'string' ? raw : JSON.parse(raw)
      if (input.schema) validateDataValue(value, input.schema)
      return [[input.name, value]]
    }),
  )
}

export function itemWorkflowInputsReady(
  defId: string,
  inputs: readonly WorkflowInput[],
  valueOf: (name: string) => string,
): boolean {
  if (!defId || inputs.some((input) => input.required && !valueOf(input.name).trim())) return false
  try {
    collectItemWorkflowInputs(inputs, valueOf)
    return true
  } catch {
    return false
  }
}
