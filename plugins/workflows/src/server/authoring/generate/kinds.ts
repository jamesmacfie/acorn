import type { StepField, StepFieldOption, WorkflowCatalog } from '../../../shared/workflowContracts'
import { GENERATE_MAX_FIELD_OPTIONS, GENERATE_MAX_KIND_CHARS } from './limits'
import { isForbiddenField } from './forbiddenKeys'

// --- 3. the step kinds, from the catalog ---

/** Degrade the whole kind section together to keep one consistent detail level. */
type KindDetail = 0 | 1 | 2 | 3 | 4

const SECTION_KINDS_PREAMBLE = [
  '## 3. Step kinds',
  '',
  'Every kind this node can run is below. Using one that is not here is an error.',
  '',
  'A built-in kind is a bare word, `"kind": "agent"`. Its inputs are named keys on the step itself,',
  'and a built-in step never carries a `with` object.',
  '',
  'A contributed kind is namespaced, `"kind": "http:request"`, and every input it takes goes inside',
  '`with`. Nothing else on the step belongs to it.',
  '',
  'A dotted key is a nested contributed setting; preserve its object structure.',
  '',
  "A field's JSON type follows the word in brackets. `text`, `textarea`, `prompt` and `string` are",
  'all strings, `number` is a number, `boolean` is true or false, and a field written as "one of" takes',
  'one of the values listed. Structured fields schema, query, record, and condition are JSON objects, not JSON-encoded strings.',
  'Find records query is {kind:"saved",queryId,revision,bindings} or {kind:"inline",content,bindings}. Each binding uses {address:{from:"input",name,pointer}} or {address:{from:"step",stepId,pointer}}.',
  'Get record details record binds the exact /ref object, retaining its scope. If condition is {kind:"comparison",left:<binding>,operator:"eq",right:{address:{from:"literal",value:true}}}, or a bounded all/any group of predicates.',
  '',
  'A kind marked "runs an agent" may also take `profileId`, `isolation` and `inputs`. On any other',
  'kind `isolation` and `inputs` are errors and `profileId` does nothing, so leave all three off.',
].join('\n')

const optionValues = (options: readonly StepFieldOption[], detail: KindDetail): string => {
  const shown = detail >= 3 ? options.slice(0, GENERATE_MAX_FIELD_OPTIONS) : options
  const rest = options.length - shown.length
  return [shown.map((option) => option.value).join(', '), ...(rest > 0 ? [`and ${rest} more`] : [])].join(', ')
}

const fieldType = (field: StepField, detail: KindDetail): string => {
  // A select without fixed options holds an identifier. The model needs its JSON type, not the
  // editor control name.
  if (field.type === 'select') return field.options?.length ? `one of ${optionValues(field.options, detail)}` : 'string'
  if (field.type === 'number' && (field.min != null || field.max != null)) {
    return `number from ${field.min ?? 'any'} to ${field.max ?? 'any'}`
  }
  if (field.type === 'child-workflow') return 'child workflow object'
  if (field.type === 'workflow-map-source') return 'structured map source object'
  if (field.type === 'workflow-json-pointer') return 'JSON Pointer string'
  if (field.type === 'workflow-title') return 'bound title object'
  return field.type
}

/** One line of a kind's key list, from either a described field or the table below. */
type PromptField = { id: string; shape: string; hint?: string }

const fieldLine = (field: PromptField, prefix: string, detail: KindDetail): string =>
  `- \`${prefix}${field.id}\` (${field.shape}).${detail === 0 && field.hint ? ` ${field.hint}` : ''}`

/** Built-in keys that the editor draws as graph edges rather than form controls. The model needs
 *  these keys, but adding them to `describe` would create unusable inspector fields. */
const UNDESCRIBED_FIELDS: Readonly<Record<string, readonly PromptField[]>> = {
  decide: [{ id: 'branches', shape: 'object of verdict to downstream step ID, required', hint: 'Section 4 shows one.' }],
  if: [{ id: 'branches', shape: 'object with true and otherwise keys naming downstream step IDs, required', hint: 'Deterministic condition; no AI call. condition uses the shared typed predicate and bindings.' }],
}

type CatalogKind = WorkflowCatalog['kinds'][number]

/** Built-ins first and then each plugin's, which is the order the editor's Add menu uses. */
const orderedKinds = (catalog: WorkflowCatalog): CatalogKind[] =>
  [...catalog.kinds].sort((a, b) => Number(a.pluginId !== null) - Number(b.pluginId !== null))

const kindFields = (kind: CatalogKind, detail: KindDetail): PromptField[] => [
  ...(kind.describe?.fields ?? [])
    .filter((field) => kind.pluginId !== null || !isForbiddenField(field.id))
    .map((field) => ({
      id: field.id,
      shape: [fieldType(field, detail), ...(field.required ? ['required'] : [])].join(', '),
      hint: field.hint,
    })),
  ...(kind.pluginId === null ? UNDESCRIBED_FIELDS[kind.id] ?? [] : []),
  // Top-level keys, then nested ones, so an object is not split around one child key. The sort is
  // stable, so each group keeps the order it was described in.
].sort((a, b) => Number(a.id.includes('.')) - Number(b.id.includes('.')))

const kindBlock = (kind: CatalogKind, detail: KindDetail): string => {
  const builtin = kind.pluginId === null
  const fields = kindFields(kind, detail)
  const prefix = builtin ? '' : 'with.'
  const lines = [`### \`${kind.id}\``]
  const summary = [
    kind.describe?.label ?? kind.id,
    ...(builtin ? [] : [`Contributed by the ${kind.pluginId} plugin`]),
    ...(kind.describe?.runsAgent ? ['Runs an agent'] : []),
  ].join('. ')
  lines.push(`${summary}.`)
  if (detail <= 1 && kind.describe?.description) lines.push(kind.describe.description)
  if (!kind.describe) {
    lines.push('This kind ships no description, so its inputs are not listed here. Use it only when the')
    lines.push('description names it, and put whatever it needs in `with`.')
  } else if (!fields.length) lines.push(builtin ? 'It takes no fields of its own.' : 'It takes no `with` keys.')
  else {
    lines.push(builtin ? 'Keys on the step:' : 'Keys inside `with`:')
    lines.push(...fields.map((field) => fieldLine(field, prefix, detail)))
  }
  if (detail <= 1 && kind.describe?.output) lines.push(`Its output: ${kind.describe.output.description}`)
  return lines.join('\n')
}

const kindOneLine = (kind: CatalogKind): string => {
  const prefix = kind.pluginId === null ? '' : 'with.'
  const fields = kindFields(kind, 4)
  const keys = fields.length ? fields.map((field) => `${prefix}${field.id}`).join(', ') : 'no keys'
  return `- \`${kind.id}\`, ${kind.describe?.label ?? kind.id}: ${keys}`
}

const kindsAt = (catalog: WorkflowCatalog, detail: KindDetail): string => {
  const kinds = orderedKinds(catalog)
  if (!kinds.length) return [SECTION_KINDS_PREAMBLE, '', 'This node has no step kinds at all, so no definition it runs can have a step.'].join('\n')
  if (detail === 4) {
    return [SECTION_KINDS_PREAMBLE, '', 'Only the ids and their keys fit here.', '', ...kinds.map(kindOneLine)].join('\n')
  }
  return [SECTION_KINDS_PREAMBLE, ...kinds.map((kind) => kindBlock(kind, detail))].join('\n\n')
}

/** The kinds, as large as they fit. Never fewer kinds, only less about each one: drop the hints,
 *  then the descriptions and output notes, then cap each list of values, then one line per kind. */
export function renderStepKinds(catalog: WorkflowCatalog, budget = GENERATE_MAX_KIND_CHARS): string {
  for (const detail of [0, 1, 2, 3] as const) {
    const text = kindsAt(catalog, detail)
    if (text.length <= budget) return text
  }
  return kindsAt(catalog, 4)
}
