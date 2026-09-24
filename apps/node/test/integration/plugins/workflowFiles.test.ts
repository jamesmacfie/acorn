import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadWorkflowFiles } from '@acorn/plugin-workflows/testkit'
import { registerBuiltInProfiles } from '@acorn/plugin-agents/node/index.ts'

registerBuiltInProfiles()

describe('workflow files', () => {
  let root: string
  let repo: string
  let user: string

  const write = (base: string, id: string, text: string) => {
    mkdirSync(join(base, '.acorn', 'workflows'), { recursive: true })
    writeFileSync(join(base, '.acorn', 'workflows', `${id}.toml`), text)
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'acorn-workflow-files-'))
    repo = join(root, 'repo')
    user = join(root, 'user')
    mkdirSync(repo)
    mkdirSync(user)
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('loads a baseline-1 graph with stable ids and typed inputs', () => {
    write(repo, 'review', `
baseline = "acorn-1"
format_version = 1
name = "Review"

[[inputs]]
name = "issue"
schema_json = '{"type":"string"}'
required = true

[[steps]]
id = "read"
name = "Read the issue"
after = []
prompt = "Read the supplied issue"

[[steps]]
id = "approve"
name = "Approve"
kind = "gate-human"
after = ["read"]
`)
    const loaded = loadWorkflowFiles(repo, user)
    expect(loaded.errors).toEqual([])
    expect(loaded.workflows[0]).toMatchObject({
      id: 'review', baseline: 'acorn-1', formatVersion: 1,
      inputs: [{ name: 'issue', schema: { type: 'string' }, required: true }],
      steps: [{ id: 'read', after: [] }, { id: 'approve', after: ['read'] }],
    })
  })

  it('expands sub-workflows and prefixes stable references', () => {
    write(repo, 'pair', `
baseline = "acorn-1"
format_version = 1
[[steps]]
id = "left"
name = "Left"
after = []
[[steps]]
id = "right"
name = "Right"
after = ["left"]
`)
    write(repo, 'outer', `
baseline = "acorn-1"
format_version = 1
[[steps]]
id = "build"
name = "Build"
[[steps]]
id = "pair"
workflow = "pair"
`)
    const loaded = loadWorkflowFiles(repo, user)
    expect(loaded.errors).toEqual([])
    expect(loaded.workflows.find(workflow => workflow.id === 'outer')?.steps.map(step => [step.id, step.after])).toEqual([
      ['build', undefined], ['pair:left', []], ['pair:right', ['pair:left']],
    ])
  })

  it('refuses old files with an actionable transition diagnostic', () => {
    write(repo, 'old', `
[[steps]]
name = "Build"
prompt = "Build it"
`)
    const loaded = loadWorkflowFiles(repo, user)
    expect(loaded.workflows).toEqual([])
    expect(loaded.errors[0]?.message).toContain('Set format_version = 1 and baseline = "acorn-1"')
  })

  it('refuses retired execution kinds instead of translating them', () => {
    write(repo, 'retired', `
baseline = "acorn-1"
format_version = 1
[[steps]]
id = "parallel"
name = "Parallel"
kind = "fan-out"
`)
    const loaded = loadWorkflowFiles(repo, user)
    expect(loaded.workflows).toEqual([])
    expect(loaded.errors.map(error => error.message).join('\n')).toContain("unknown kind 'fan-out'")
  })

  it('keeps repository precedence without accepting an old shadow', () => {
    write(repo, 'flow', `
baseline = "acorn-1"
format_version = 1
[[steps]]
id = "repo"
name = "Repository"
`)
    write(user, 'flow', `
[[steps]]
name = "Old user copy"
`)
    const loaded = loadWorkflowFiles(repo, user)
    expect(loaded.workflows).toHaveLength(1)
    expect(loaded.workflows[0]?.steps[0]?.id).toBe('repo')
    expect(loaded.errors).toEqual([expect.objectContaining({ source: 'user:flow', message: expect.stringContaining('baseline = "acorn-1"') })])
  })
})
