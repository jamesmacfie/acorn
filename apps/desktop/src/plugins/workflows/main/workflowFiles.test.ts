import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadWorkflowFiles } from './workflowFiles'
import { normalizePersistedWorkflow } from './workflowValidation'

describe('workflow files (docs/workflows.md)', () => {
  let dir: string
  let repoDir: string
  let userDir: string

  const writeWf = (base: string, id: string, text: string) => {
    mkdirSync(join(base, '.acorn', 'workflows'), { recursive: true })
    writeFileSync(join(base, '.acorn', 'workflows', `${id}.toml`), text)
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'acorn-wff-'))
    repoDir = join(dir, 'repo')
    userDir = join(dir, 'home')
    mkdirSync(repoDir)
    mkdirSync(userDir)
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('parses the 14 §example shape: steps, gates, ci-loop, fan-out, requires_run', () => {
    writeWf(
      repoDir,
      'super-flow',
      `
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
`,
    )
    const { workflows, errors } = loadWorkflowFiles(repoDir, userDir)
    expect(errors).toEqual([])
    expect(workflows).toHaveLength(1)
    const wf = workflows[0]
    expect(wf.id).toBe('super-flow')
    expect(wf.posture).toBe('gated')
    expect(wf.steps.map((s) => [s.name, s.kind ?? 'agent'])).toEqual([
      ['plan', 'fan-out'],
      ['aggregate', 'join'],
      ['e2e', 'agent'],
      ['ship?', 'gate-human'],
      ['verify', 'gate-policy'],
      ['ci-fix', 'ci-loop'],
    ])
    expect(wf.steps[0].model).toBe('opus')
    expect(wf.steps[0].schema).toEqual({ type: 'object' })
    expect(wf.steps[0].childStep?.prompt).toBe('Build this slice.')
    expect(wf.steps[1].joins).toBe('plan')
    expect(wf.steps[2].requiresRun).toBe('dev')
    expect(wf.steps[5].maxIterations).toBe(3)
  })

  it('sub-workflow references expand inline (one reusable block); repo layer wins over user', () => {
    writeWf(repoDir, 'review-block', `
[[steps]]
name = "review"
prompt = "Review."
[[steps]]
name = "verify"
kind = "gate-policy"
policy = "checks-green"
`)
    writeWf(repoDir, 'main-flow', `
[[steps]]
name = "build"
prompt = "Build."
[[steps]]
workflow = "review-block"
`)
    writeWf(userDir, 'main-flow', `
[[steps]]
name = "user-version"
prompt = "Should be shadowed."
`)
    const { workflows, errors } = loadWorkflowFiles(repoDir, userDir)
    expect(errors).toEqual([])
    const main = workflows.find((w) => w.id === 'main-flow')!
    expect(main.source).toBe('repo')
    expect(main.steps.map((s) => s.name)).toEqual(['build', 'review-block:review', 'review-block:verify'])
  })

  it('malformed TOML and unknown kinds are surfaced errors, not silent skips', () => {
    writeWf(repoDir, 'broken', '[[steps\nname = "x"')
    writeWf(repoDir, 'bad-kind', `
[[steps]]
name = "x"
kind = "teleport"
`)
    writeWf(repoDir, 'empty', 'name = "no steps"')
    const { workflows, errors } = loadWorkflowFiles(repoDir, null)
    expect(workflows).toEqual([])
    expect(errors.map((e) => e.source).sort()).toEqual(['repo:bad-kind', 'repo:broken', 'repo:empty'])
  })

  it('cyclic sub-workflow references are rejected with an error, never a hang', () => {
    writeWf(repoDir, 'a', `
[[steps]]
workflow = "b"
`)
    writeWf(repoDir, 'b', `
[[steps]]
workflow = "a"
`)
    writeWf(repoDir, 'self', `
[[steps]]
workflow = "self"
`)
    const { workflows, errors } = loadWorkflowFiles(repoDir, null)
    expect(workflows).toEqual([])
    expect(errors.some((e) => e.message.includes('cyclic'))).toBe(true)
    expect(errors.filter((e) => e.message.includes('cyclic')).length).toBeGreaterThanOrEqual(2)
  })

  it('fails early with named join, branch, template, and tool-ceiling errors', () => {
    writeWf(repoDir, 'bad-join', `
[[steps]]
name = "join"
kind = "join"
joins = "missing-plan"
`)
    writeWf(repoDir, 'bad-branch', `
[[steps]]
name = "earlier"
[[steps]]
name = "route"
kind = "decide"
[steps.branches]
yes = "earlier"
no = "missing"
`)
    writeWf(repoDir, 'bad-template', `
[[steps]]
name = "first"
prompt = "\${steps.later.output}"
[[steps]]
name = "later"
`)
    writeWf(repoDir, 'wide-tools', `
name = "wide"
[tools]
allow = ["read_tool"]
[[steps]]
name = "build"
[steps.tools]
allow = ["read_tool", "write_tool"]
`)

    const { workflows, errors } = loadWorkflowFiles(repoDir, null)
    expect(workflows).toEqual([])
    const messages = errors.map((error) => error.message).join('\n')
    expect(messages).toContain("dangling join 'missing-plan'")
    expect(messages).toContain("backward target 'earlier'")
    expect(messages).toContain("invalid target 'missing'")
    expect(messages).toContain("forward template reference 'later'")
    expect(messages).toContain('tool ceiling widens the workflow ceiling')
  })

  it('parses decide branches, output templates, explicit joins, and inherited tool ceilings', () => {
    writeWf(repoDir, 'phase-8', `
name = "phase 8"
[tools]
max_risk = "write"
allow = ["read_tool", "write_tool"]

[[steps]]
name = "plan"
kind = "fan-out"
prompt = "Plan"

[[steps]]
name = "join"
kind = "join"
joins = "plan"

[[steps]]
name = "route"
kind = "decide"
prompt = "Choose from \${steps.join.output}"
[steps.branches]
ship = "ship"
default = "revise"

[[steps]]
name = "ship"
[steps.tools]
max_risk = "read"

[[steps]]
name = "revise"
`)
    const { workflows, errors } = loadWorkflowFiles(repoDir, null)
    expect(errors).toEqual([])
    expect(workflows[0]).toMatchObject({
      tools: { allow: ['read_tool', 'write_tool'], maxRisk: 'write' },
      steps: [
        { name: 'plan', kind: 'fan-out' },
        { name: 'join', joins: 'plan' },
        { name: 'route', branches: { ship: 'ship', default: 'revise' } },
        { name: 'ship', tools: { maxRisk: 'read' } },
        { name: 'revise' },
      ],
    })
  })

  it('read-normalizes a frozen pre-Phase-8 implicit join without weakening new-file validation', () => {
    const normalized = normalizePersistedWorkflow({
      name: 'legacy',
      steps: [
        { name: 'plan', kind: 'fan-out' },
        { name: 'join', kind: 'join' },
      ],
    })
    expect(normalized.steps[1].joins).toBe('plan')
  })
})
