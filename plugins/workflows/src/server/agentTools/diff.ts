import type { WorkflowDef } from '../../shared/workflowContracts'
import { stepIdentity } from '../../shared/workflowIdentity'
import { workflowContentFingerprint } from '../definitions/fingerprint'

type NamedChanges = { added: string[]; removed: string[]; changed: string[] }

/** What a save changed, by name rather than by line: the settings, inputs, outputs, and steps that
 *  differ, and for each changed step the fields that did. Steps match by stable ID. */
export type WorkflowSemanticDiff = {
  settings: string[]
  inputs: NamedChanges
  outputs: NamedChanges
  steps: { added: string[]; removed: string[]; changed: { step: string; fields: string[] }[] }
}

const same = (left: unknown, right: unknown): boolean =>
  workflowContentFingerprint(left ?? null) === workflowContentFingerprint(right ?? null)

function named<T>(
  before: readonly T[],
  after: readonly T[],
  key: (item: T) => string,
): { added: string[]; removed: string[]; pairs: [string, T, T][] } {
  const old = new Map(before.map((item) => [key(item), item]))
  const next = new Map(after.map((item) => [key(item), item]))
  return {
    added: [...next.keys()].filter((name) => !old.has(name)),
    removed: [...old.keys()].filter((name) => !next.has(name)),
    pairs: [...next.entries()].flatMap(([name, item]) =>
      old.has(name) ? [[name, old.get(name)!, item] as [string, T, T]] : [],
    ),
  }
}

const changedFields = (before: object, after: object): string[] =>
  [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((field) => !same((before as Record<string, unknown>)[field], (after as Record<string, unknown>)[field]))
    .sort()

function namedChanges<T>(
  before: readonly T[] | undefined,
  after: readonly T[] | undefined,
  key: (item: T) => string,
): NamedChanges {
  const { added, removed, pairs } = named(before ?? [], after ?? [], key)
  return { added, removed, changed: pairs.filter(([, left, right]) => !same(left, right)).map(([name]) => name) }
}

/** `before` is null for a new definition, which then reads as every part added. */
export function workflowSemanticDiff(before: WorkflowDef | null, after: WorkflowDef): WorkflowSemanticDiff {
  const { steps: oldSteps, inputs: oldInputs, outputs: oldOutputs, ...oldSettings } = before ?? { steps: [] }
  const { steps: newSteps, inputs: newInputs, outputs: newOutputs, ...newSettings } = after
  const steps = named(oldSteps, newSteps, stepIdentity)
  return {
    settings: before ? changedFields(oldSettings, newSettings) : Object.keys(newSettings).sort(),
    inputs: namedChanges(oldInputs, newInputs, (input) => input.name),
    outputs: namedChanges(oldOutputs, newOutputs, (output) => output.name),
    steps: {
      added: steps.added,
      removed: steps.removed,
      changed: steps.pairs.flatMap(([step, left, right]) => {
        const fields = changedFields(left, right)
        return fields.length ? [{ step, fields }] : []
      }),
    },
  }
}
