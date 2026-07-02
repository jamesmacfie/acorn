import { describe, expect, it } from 'vitest'
import type { TaskContext } from './api'
import { formatContextBlock } from './contextBlock'

const ctx: TaskContext = {
  task: { id: 't1', title: 'fix: guard null token', repo: 'acme/api', branch: 'fix/null-token', worktreePath: null, pullNumber: 813 },
  pr: { number: 813, title: 'fix: guard null token', body: '<p>Guards the token properly.</p>', changedFiles: ['src/a.ts', 'src/b.ts'] },
  issues: [
    { provider: 'rollbar', identifier: '142', title: 'TypeError: token is null', detail: 'prod' },
    { provider: 'linear', identifier: 'ENG-42', title: 'Login crashes for SSO users', detail: 'In Progress' },
  ],
  notes: [{ title: 'repro steps', body: 'login with SSO, token missing' }],
  memory: [{ name: 'auth-conventions', description: 'how auth flows work' }],
}

describe('formatContextBlock (docs/next 11 — compact push)', () => {
  it('renders titles-not-bodies with stable section ordering', () => {
    const out = formatContextBlock(ctx)
    expect(out).toBe(`# Task: fix: guard null token (acme/api · fix/null-token)

## PR #813: fix: guard null token
Guards the token properly.
Changed files (2): src/a.ts, src/b.ts

## Linked issues
- [rollbar] 142 — TypeError: token is null (prod)
- [linear] ENG-42 — Login crashes for SSO users (In Progress)

## Notes
### repro steps
login with SSO, token missing

## Repo memory (index — ask for bodies via memory_get)
- auth-conventions — how auth flows work`)
  })

  it('caps a long PR body and a long file list', () => {
    const long = formatContextBlock({
      ...ctx,
      pr: { number: 1, title: 'big', body: 'x'.repeat(2000), changedFiles: Array.from({ length: 40 }, (_, i) => `f${i}.ts`) },
    })
    expect(long).toContain('…')
    expect(long).toContain('+10 more')
    expect(long.length).toBeLessThan(1600)
  })

  it('omits empty sections entirely', () => {
    const bare = formatContextBlock({ ...ctx, pr: undefined, issues: [], notes: [], memory: [] })
    expect(bare).toBe('# Task: fix: guard null token (acme/api · fix/null-token)')
  })
})
