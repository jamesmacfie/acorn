import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadWorkflowFiles } from './workflowFiles'

describe('workflow files (docs/next 14 P5)', () => {
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
})
