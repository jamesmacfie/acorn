import { describe, expect, it } from 'vitest'
import { parseWorkflowToml } from './workflowFiles'
import { uniqueWorkflowSlug, workflowSlug, writeWorkflowToml } from './workflowToml'

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

describe('writing a definition back as TOML', () => {
  it('round trips the shape the loader tests use: gates, fan-out, joins, a child step', () => {
    const { parsed, again } = roundTrip(`
name = "super flow"
posture = "gated"

[[steps]]
name = "plan"
kind = "fan-out"
model = "opus"
prompt = "Split the ticket."
schema_json = '{"type":"object"}'
[steps.child_step]
name = "build"
prompt = "Build this slice."

[[steps]]
name = "aggregate"
kind = "join"
joins = "plan"

[[steps]]
name = "e2e"
prompt = "Verify in the browser."
requires_run = "dev"

[[steps]]
name = "ship?"
kind = "gate-human"

[[steps]]
name = "verify"
kind = "gate-policy"
policy = "checks-green"

[[steps]]
name = "ci-fix"
kind = "ci-loop"
max_iterations = 3
`)
    expect(again).toEqual(parsed)
  })

  it('round trips every field the model declares, including branches, ceilings and budgets', () => {
    const { parsed, again } = roundTrip(`
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
description = "The bug report"
required = true

[[inputs]]
name = "focus"
default = "the parser"

[[steps]]
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

[[steps]]
name = "recent-changes"
after = []
kind = "http:request"
[steps.with]
url = "https://example.test/log"
retries = 2
follow = true

[[steps]]
name = "route"
kind = "decide"
after = ["reproduce", "recent-changes"]
prompt = "Which way?"
[steps.branches]
yes = "ship"
no = "stop"

[[steps]]
name = "ship"
after = ["route"]
prompt = "Ship it."

[[steps]]
name = "stop"
after = ["route"]
kind = "gate-human"
`)
    expect(again).toEqual(parsed)
    expect(parsed.steps[0].after).toEqual([])
    expect(parsed.inputs).toHaveLength(2)
  })

  it('writes a multi-line prompt as a literal block, so `${…}` survives unescaped', () => {
    const { written, parsed, again } = roundTrip(`
name = "templated"
[[inputs]]
name = "issue"

[[steps]]
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
name = "awkward"
[[steps]]
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
    const def = { name: 'edge', steps: [{ name: 'a', prompt: "one\ntwo '''" }] }
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
