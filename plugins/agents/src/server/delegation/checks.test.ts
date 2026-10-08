import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { makeTestNodeContext } from '@acorn/plugin-api/testkit'
import type { AgentTurn } from '../../contract/wire.ts'
import type { AgentCheck } from '../../shared/delegationSchemas'
import { agentPromptInputSchema } from '../../shared/delegationSchemas'
import { DelegationChecks } from './checks'

describe('delegation checks', () => {
  const ctx = makeTestNodeContext({ plugin: { name: 'agents' } })
  afterAll(() => ctx.cleanup())
  const roots: string[] = []
  afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })
  const root = async () => { const path = await mkdtemp(join(tmpdir(), 'acorn-checks-')); roots.push(path); return path }
  const turn = (checks: AgentCheck[], status: AgentTurn['status'] = 'completed') => ({ status, effectivePolicy: { checks } }) as unknown as AgentTurn
  const run = (checks: AgentCheck[], path: string, base?: string, status: AgentTurn['status'] = 'completed') =>
    new DelegationChecks(ctx.core).runInRoot(turn(checks, status), path, base)

  it('rejects escaping and excessive checks at the tool boundary', () => {
    const input = (checks: unknown[]) => agentPromptInputSchema.safeParse({
      sessionId: '11111111-1111-4111-8111-111111111111', prompt: 'Check.', checks,
    }).success
    expect(input([{ kind: 'file-exists', path: '../escape' }])).toBe(false)
    expect(input([{ kind: 'json-valid', path: '/absolute' }])).toBe(false)
    expect(input([{ kind: 'file-nonempty' }])).toBe(false)
    expect(input(Array.from({ length: 9 }, () => ({ kind: 'commits-ahead' })))).toBe(false)
    expect(input([{ kind: 'file-exists', path: 'nested/output.json' }])).toBe(true)
  })

  it('classifies missing, empty, and symlink escapes', async () => {
    const path = await root()
    const outside = await root()
    await writeFile(join(path, 'empty'), '')
    await writeFile(join(outside, 'secret'), 'secret')
    await symlink(join(outside, 'secret'), join(path, 'escape'))
    const result = await run([
      { kind: 'file-exists', path: 'missing' },
      { kind: 'file-nonempty', path: 'empty' },
      { kind: 'file-exists', path: 'escape' },
      { kind: 'file-exists', path: 'empty' },
    ], path)
    expect(result.verdicts.map((v) => v.status)).toEqual(['fails', 'fails', 'unverified', 'holds'])
  })

  it('bounds JSON and rejects malformed UTF-8 and syntax', async () => {
    const path = await root()
    await writeFile(join(path, 'large.json'), Buffer.alloc(1024 * 1024 + 1, 32))
    await writeFile(join(path, 'utf8.json'), Buffer.from([0xff]))
    await writeFile(join(path, 'syntax.json'), '{')
    await writeFile(join(path, 'valid.json'), '{"ok":true}')
    const result = await run(['large', 'utf8', 'syntax', 'valid'].map((name) => ({ kind: 'json-valid', path: `${name}.json` })), path)
    expect(result.verdicts.map((v) => v.status)).toEqual(['unverified', 'fails', 'fails', 'holds'])
  })

  it('compares HEAD with the captured base commit and marks unfinished turns unverified', async () => {
    const path = await root()
    const git = (args: string[]) => ctx.core.git.gitText(args, { cwd: path })
    await git(['init'])
    await writeFile(join(path, 'one'), 'one')
    await git(['add', 'one'])
    await git(['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'base'])
    const base = await git(['rev-parse', 'HEAD'])
    expect((await run([{ kind: 'commits-ahead' }], path, base)).verdicts[0]?.status).toBe('fails')
    await writeFile(join(path, 'two'), 'two')
    await git(['add', 'two'])
    await git(['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'next'])
    expect((await run([{ kind: 'commits-ahead' }], path, base)).verdicts[0]?.status).toBe('holds')
    expect((await run([{ kind: 'commits-ahead' }], path, base, 'failed')).verdicts[0]?.status).toBe('unverified')
  })
})
