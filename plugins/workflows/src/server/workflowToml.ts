// Turning a definition back into the file the loader reads (docs/workflows.md § Database
// definitions). "Save to repo" is the one caller: a row drafted in the editor becomes
// `.acorn/workflows/<slug>.toml`, which the trust snapshot then covers like any other committed
// configuration.
//
// The keys here are the mirror of ./workflowFiles.ts § parseStep, snake case on the wire. The
// property that keeps the two honest is a round trip, not a reading: parse, write, parse again, and
// the two definitions must match (./workflowToml.test.ts). Serialising is `smol-toml`'s job rather
// than ours, apart from the one thing it will not do, below.
import { stringify } from 'smol-toml'
import type { ToolCeiling, WorkflowBudget, WorkflowChildStepDef, WorkflowDef, WorkflowStepDef } from '../shared/workflowContracts'

// A prompt is the reason this file is not a plain `stringify` call. smol-toml writes every string as
// a basic one, so a five-line prompt lands as a single line with `\n` in it, and a file somebody is
// meant to review in a pull request should not read like that. Each multi-line string is swapped for
// a marker before serialising and the marker's quoted line is replaced afterwards with a TOML
// multi-line literal, which has no escapes at all.
const MARKER = (at: number) => `@@acorn-multiline-${at}@@`
// Anything a literal block cannot hold: its own delimiter, a trailing quote that would run into the
// closing one, or a control character other than tab and the two newline bytes.
const literalSafe = (value: string) => !value.includes("'''") && !value.endsWith("'") && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)

// Only `undefined` goes. An empty array is not the same as an absent one: `after = []` is how a step
// says it is a root, and dropping it would change what the file means.
const drop = <T extends Record<string, unknown>>(table: T): Record<string, unknown> =>
  Object.fromEntries(Object.entries(table).filter(([, value]) => value !== undefined))

// The three the loader collapses when they are empty, so writing an empty one would not survive the
// next read (./workflowFiles.ts § parseInputs, parseStringTable, parseBranches).
const some = <T extends object>(value: T | undefined): T | undefined =>
  value && (Array.isArray(value) ? value.length : Object.keys(value).length) ? value : undefined

const tomlTools = (tools: ToolCeiling | undefined): Record<string, unknown> | undefined => {
  if (!tools) return undefined
  const table = drop({ allow: tools.allow, max_risk: tools.maxRisk })
  return Object.keys(table).length ? table : undefined
}

const tomlBudget = (budget: WorkflowBudget | undefined): Record<string, unknown> | undefined => {
  if (!budget) return undefined
  const table = drop({
    max_wall_time_ms: budget.maxWallTimeMs,
    max_cost_usd: budget.maxCostUsd,
    max_input_tokens: budget.maxInputTokens,
    max_output_tokens: budget.maxOutputTokens,
    max_turns: budget.maxTurns,
  })
  return Object.keys(table).length ? table : undefined
}

// `schema` is not a child-step key: ./workflowFiles.ts does not read one, so writing one would make
// a value that vanishes on the next load.
const tomlChildStep = (child: WorkflowChildStepDef | undefined): Record<string, unknown> | undefined => {
  if (!child) return undefined
  const table = drop({
    name: child.name,
    profile: child.profileId,
    model: child.model,
    prompt: child.prompt,
    tools: tomlTools(child.tools),
    budget: tomlBudget(child.budget),
  })
  return Object.keys(table).length ? table : undefined
}

const tomlStep = (step: WorkflowStepDef): Record<string, unknown> =>
  drop({
    name: step.name,
    kind: step.kind,
    after: step.after,
    isolation: step.isolation,
    inputs: step.inputs,
    config_options: some(step.configOptions),
    profile: step.profileId,
    model: step.model,
    prompt: step.prompt,
    schema_json: step.schema ? JSON.stringify(step.schema) : undefined,
    policy: step.policy,
    max_iterations: step.maxIterations,
    requires_run: step.requiresRun,
    joins: step.joins,
    branches: some(step.branches),
    child_step: tomlChildStep(step.childStep),
    with: step.with,
    tools: tomlTools(step.tools),
    budget: tomlBudget(step.budget),
  })

/** The definition as the text of a `.acorn/workflows/*.toml` file, ending in a newline. */
export function writeWorkflowToml(def: WorkflowDef): string {
  const blocks: string[] = []
  // Walk what we are about to serialise, not the definition, so a multi-line string anywhere —
  // a prompt, a child prompt, a contributed kind's `with` — is treated the same way.
  const mark = (value: unknown): unknown => {
    if (typeof value === 'string') {
      if (!value.includes('\n') || !literalSafe(value)) return value
      blocks.push(value)
      return MARKER(blocks.length - 1)
    }
    if (Array.isArray(value)) return value.map(mark)
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mark(item)]))
    return value
  }

  const doc = mark(drop({
    name: def.name,
    posture: def.posture,
    trigger: def.trigger,
    tools: tomlTools(def.tools),
    budget: tomlBudget(def.budget),
    inputs: some(def.inputs)?.map((input) => drop({ name: input.name, description: input.description, required: input.required === true ? true : undefined, default: input.default })),
    steps: def.steps.map(tomlStep),
  }))

  let text = stringify(doc as Record<string, unknown>)
  // A function replacement, because `$'` and `$&` in a prompt are special in a replacement string.
  for (const [at, block] of blocks.entries()) text = text.replace(`"${MARKER(at)}"`, () => `'''\n${block}'''`)
  return text.endsWith('\n') ? text : `${text}\n`
}

/** A file id from a definition name. Slug-shaped, so it is also a legal step-reference target and
 *  cannot address anything but a file inside the folder. */
export function workflowSlug(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48).replace(/-+$/, '')
  return slug || 'workflow'
}

/** The same, made unique against the ids the folder already holds. */
export function uniqueWorkflowSlug(name: string, taken: ReadonlySet<string>): string {
  const base = workflowSlug(name)
  if (!taken.has(base)) return base
  for (let at = 2; at < 1000; at += 1) {
    if (!taken.has(`${base}-${at}`)) return `${base}-${at}`
  }
  return `${base}-${Date.now()}`
}
