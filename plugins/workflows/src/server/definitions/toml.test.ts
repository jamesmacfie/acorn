import { describe, expect, it } from 'vitest'
import { parseWorkflowToml } from './files'
import { uniqueWorkflowSlug, workflowSlug, writeWorkflowToml } from './toml'

// The writer's contract is a round trip, not a shape: whatever the loader read out of a file, writing
// it and reading it again must give the same definition back (docs/workflows.md § Database
// definitions). Anything the writer forgets to spell shows up here as a missing field.

const roundTrip = (text: string) => {
  const errors: { source: string; message: string }[] = []
  const parsed = parseWorkflowToml(text, 'fixture', 'repo', errors)
  expect(errors).toEqual([])
  expect(parsed).not.toBeNull()
  const written = writeWorkflowToml(parsed!)
  const again = parseWorkflowToml(written, 'fixture', 'repo', errors)
  expect(errors).toEqual([])
  return { parsed: parsed!, written, again: again! }
}

it('rejects a numeric-1 workflow without the baseline marker', () => {
  const errors: { source: string; message: string }[] = []
  expect(parseWorkflowToml('format_version = 1\n[[steps]]\nid = "work"\nname = "Work"\nprompt = "Do it"\n', 'old', 'user', errors)).toBeNull()
  expect(errors[0]?.message).toMatch(/baseline/)
})

describe('writing a definition back as TOML', () => {
  it('round trips the version-1 graph, typed inputs, branches, ceilings and budgets', () => {
    const { parsed, again } = roundTrip(`
format_version = 1
baseline = "acorn-1"
name = "everything"
posture = "autonomous"
trigger = "checks-red"
[tools]
allow = ["read_tool"]
max_risk = "read"
[budget]
max_wall_time_ms = 60000
max_cost_usd = 1.5
max_input_tokens = 100
max_output_tokens = 200
max_turns = 4

[[inputs]]
name = "issue"
schema_json = '{"type":"string"}'
description = "The bug report"
required = true

[[inputs]]
name = "focus"
schema_json = '{"type":"string"}'
default_json = '"the parser"'

[[steps]]
id = "reproduce"
name = "reproduce"
after = []
isolation = "worktree"
inputs = "none"
profile = "claude"
model = "sonnet"
prompt = "Reproduce it."
config_options = { model = "claude-opus-5", reasoning = "high" }
[steps.tools]
allow = ["read_tool"]
[steps.budget]
max_turns = 2
max_wall_time_ms = 30000

[[steps]]
id = "recent-changes"
name = "recent-changes"
after = []
kind = "http:request"
[steps.with]
url = "https://example.test/log"
retries = 2
follow = true

[[steps]]
id = "route"
name = "route"
kind = "decide"
after = ["reproduce", "recent-changes"]
prompt = "Which way?"
[steps.branches]
yes = "ship"
no = "stop"

[[steps]]
id = "ship"
name = "ship"
after = ["route"]
prompt = "Ship it."

[[steps]]
id = "stop"
name = "stop"
after = ["route"]
kind = "gate-human"
`)
    expect(again).toEqual(parsed)
    expect(parsed.steps[0].after).toEqual([])
    expect(parsed.inputs).toHaveLength(2)
  })

  it('round trips single and mapped runtime workflow references without changing static composition', () => {
    const { parsed, written, again } = roundTrip(`
format_version = 1
baseline = "acorn-1"
name = "dispatch"
[[inputs]]
name = "ticket"
schema_json = '{"type":"string"}'

[[steps]]
id = "select"
name = "select"
after = []
schema_json = '{"type":"object"}'

[[steps]]
id = "one"
name = "one"
kind = "workflow"
[steps.child_workflow.ref]
source = "database"
id = "review-row"
[steps.child_workflow.inputs.ticket]
binding_json = '{"address":{"from":"input","name":"ticket","pointer":""}}'

[[steps]]
id = "many"
name = "many"
kind = "workflow-map"
after = ["select"]
item_key = "/id"
[steps.items]
step = "select"
pointer = "/tickets"
[steps.child_workflow.ref]
source = "repo"
path = ".acorn/workflows/review.toml"
[steps.child_workflow.inputs.ticket]
binding_json = '{"address":{"from":"item","pointer":"/number"}}'
[steps.title]
template = "Review \${ticket}"
[steps.title.bindings.ticket]
binding_json = '{"address":{"from":"item","pointer":"/number"}}'
`)
    expect(again).toEqual(parsed)
    expect(written).toContain('[steps.child_workflow.ref]')
    expect(written).not.toContain('\nworkflow = "review-row"')

    const staticErrors: { source: string; message: string }[] = []
    const staticStep = parseWorkflowToml('format_version = 1\nbaseline = "acorn-1"\n[[steps]]\nid = "review"\nworkflow = "review-block"\n', 'parent', 'repo', staticErrors)
    expect(staticErrors).toEqual([])
    expect(staticStep?.steps[0]).toMatchObject({ workflowRef: 'review-block' })
    expect(staticStep?.steps[0].childWorkflow).toBeUndefined()
  })

  it('round trips a gate form with typed fields, defaults and bindings', () => {
    const { parsed, written, again } = roundTrip(`
format_version = 1
baseline = "acorn-1"
name = "release"

[[steps]]
id = "draft"
name = "draft"
schema_json = '{"type":"object"}'

[[steps]]
id = "approve"
name = "approve"
kind = "gate-human"
[[steps.form.fields]]
name = "title"
label = "Title"
required = true
schema_json = '{"type":"string"}'
[[steps.form.fields]]
name = "notify"
schema_json = '{"type":"boolean"}'
default_json = 'false'
[steps.form.values.title]
binding_json = '{"address":{"from":"step","stepId":"draft","pointer":"/title"}}'
`)
    expect(again).toEqual(parsed)
    expect(parsed.steps[1].form).toEqual({
      fields: [
        { name: 'title', label: 'Title', required: true, schema: { type: 'string' }, description: undefined },
        { name: 'notify', label: undefined, schema: { type: 'boolean' }, default: false, description: undefined },
      ],
      values: { title: { address: { from: 'step', stepId: 'draft', pointer: '/title' } } },
    })
    expect(written).toContain('[[steps.form.fields]]')
  })

  it('writes a multi-line prompt as a literal block, so `${…}` survives unescaped', () => {
    const { written, parsed, again } = roundTrip(`
format_version = 1
baseline = "acorn-1"
name = "templated"
[[inputs]]
name = "issue"
schema_json = '{"type":"string"}'

[[steps]]
id = "look"
name = "look"
prompt = """
Reproduce the issue below.
\${inputs.issue}
Then say what you saw.
"""
`)
    expect(written).toContain("prompt = '''")
    expect(written).toContain('${inputs.issue}')
    expect(written).not.toContain('\\n')
    expect(again).toEqual(parsed)
  })

  // `$'` is a special sequence in a JavaScript replacement string, and the marker swap is a replace.
  it('survives a prompt holding replacement-pattern characters', () => {
    const { parsed, again } = roundTrip(`
format_version = 1
baseline = "acorn-1"
name = "awkward"
[[steps]]
id = "quote"
name = "quote"
prompt = """
echo $' and $& and $\` here
second line
"""
`)
    expect(again).toEqual(parsed)
    expect(parsed.steps[0].prompt).toContain("$'")
  })

  it('falls back to a quoted string when a literal block cannot hold the text', () => {
    const def = { baseline: 'acorn-1' as const, formatVersion: 1 as const, name: 'edge', steps: [{ id: 'a', name: 'a', prompt: "one\ntwo '''" }] }
    const text = writeWorkflowToml(def)
    expect(text).toContain('prompt = "one\\ntwo')
    const errors: { source: string; message: string }[] = []
    expect(parseWorkflowToml(text, 'edge', 'repo', errors)!.steps[0].prompt).toBe("one\ntwo '''")
    expect(errors).toEqual([])
  })
})

describe('the file id a saved row gets', () => {
  it('slugs the name and cannot address anything but a file in the folder', () => {
    expect(workflowSlug('Investigate an issue')).toBe('investigate-an-issue')
    expect(workflowSlug('../../etc/passwd')).toBe('etc-passwd')
    expect(workflowSlug('///')).toBe('workflow')
  })

  it('deduplicates against what the folder already holds', () => {
    expect(uniqueWorkflowSlug('Ship it', new Set())).toBe('ship-it')
    expect(uniqueWorkflowSlug('Ship it', new Set(['ship-it']))).toBe('ship-it-2')
    expect(uniqueWorkflowSlug('Ship it', new Set(['ship-it', 'ship-it-2']))).toBe('ship-it-3')
  })
})
