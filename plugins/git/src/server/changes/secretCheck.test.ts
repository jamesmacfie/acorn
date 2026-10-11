import { execFileSync } from 'node:child_process'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SecretPublicationGate } from '@acorn/plugin-api/node'
import type { SecretCheckReport } from '@acorn/protocol/secretChecks.ts'
import { localGitBridge } from './localGit'
import { changedBlobs } from './secretCheck'

// Real repositories and a local bare remote; nothing here reaches a network or a real provider.
// The token is assembled at runtime and was never issued.
const TOKEN = 'npm' + '_' + 'Q7r8S9t0U1v2W3x4Y5z6A7b8C9d0E1f2G3h4'
const CLEAN = 'export const answer = 42\n'

let dir: string
let origin: string
let enabled: boolean
let allowed: Set<string>
let admitted: Array<{ operation: string; destination: string; report: SecretCheckReport }>

// The gate's own rules are core's tests (packages/node-core/src/server/secretChecks/gate.test.ts).
// This one refuses what the real gate refuses and allows a digest the test names.
const gate: SecretPublicationGate = {
  enabled: async () => enabled,
  admit: async (input) => {
    admitted.push(input)
    if ((!input.report.counts.high && input.report.complete) || allowed.has(input.report.digest)) return null
    return {
      decisionId: 'd'.repeat(64),
      operation: input.operation,
      reason: input.report.counts.high ? 'findings' : 'incomplete',
      report: input.report,
    }
  },
}
const bridge = () =>
  localGitBridge({
    tasks: { root: async () => dir } as never,
    models: {} as never,
    checkoutAdmission: {} as never,
    secretPublication: gate,
  })
const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim()
const write = (name: string, text: string) => writeFileSync(join(dir, name), text)

beforeEach(() => {
  enabled = true
  allowed = new Set()
  admitted = []
  origin = mkdtempSync(join(tmpdir(), 'acorn-secret-origin-'))
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main'], { cwd: origin })
  dir = mkdtempSync(join(tmpdir(), 'acorn-secret-work-'))
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'test@acorn.dev')
  git('config', 'user.name', 'Acorn Test')
  git('config', 'core.hooksPath', join(dir, '.hooks'))
  git('remote', 'add', 'origin', origin)
  write('a.ts', CLEAN)
  git('add', '.')
  git('commit', '-q', '-m', 'base')
  git('push', '-q', 'origin', 'main')
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  rmSync(origin, { recursive: true, force: true })
})

describe('commit admission', () => {
  it('checks the index, not the disk', async () => {
    write('a.ts', `const t = "${TOKEN}"\n`)
    git('add', 'a.ts')
    write('a.ts', CLEAN)
    const refused = await bridge().commit('t', 'add token')
    expect(refused).toMatchObject({ ok: false, secretCheck: { operation: 'commit', reason: 'findings' } })
    expect(refused.reason).toContain('npm-token at a.ts:1')
    expect(JSON.stringify(refused)).not.toContain(TOKEN.slice(4))
    expect(git('rev-list', '--count', 'HEAD')).toBe('1')

    write('a.ts', CLEAN + '// next\n')
    git('add', 'a.ts')
    write('a.ts', `const t = "${TOKEN}"\n`)
    expect(await bridge().commit('t', 'clean staged')).toEqual({ ok: true })
  })

  it('runs no check while blocking is off', async () => {
    enabled = false
    write('a.ts', `const t = "${TOKEN}"\n`)
    git('add', 'a.ts')
    expect(await bridge().commit('t', 'allowed')).toEqual({ ok: true })
    expect(admitted).toEqual([])
  })

  it('binds the digest to the staged tree and the commit options', async () => {
    write('a.ts', `const t = "${TOKEN}"\n`)
    git('add', 'a.ts')
    await bridge().commit('t', 'one')
    await bridge().commit('t', 'one', { signoff: true })
    write('b.ts', CLEAN + '\n')
    git('add', 'b.ts')
    await bridge().commit('t', 'one')
    const [first, signed, changed] = admitted.map((entry) => entry.report.digest)
    expect(new Set([first, signed, changed]).size).toBe(3)

    allowed.add(changed!)
    expect(await bridge().commit('t', 'one')).toEqual({ ok: true })
  })

  it('checks tracked changes for commit -a, and the whole final tree for an amend', async () => {
    write('a.ts', `const t = "${TOKEN}"\n`)
    expect((await bridge().commit('t', 'all', { all: true })).secretCheck?.reason).toBe('findings')

    enabled = false
    expect(await bridge().commit('t', 'all', { all: true })).toEqual({ ok: true })
    enabled = true
    // Rewording the commit that holds the token records the same final tree.
    expect((await bridge().commit('t', 'reworded', { amend: true })).secretCheck?.reason).toBe('findings')
  })

  it('undoes a commit when a native hook stages a secret after the check', async () => {
    execFileSync('mkdir', ['-p', join(dir, '.hooks')])
    const hook = join(dir, '.hooks', 'pre-commit')
    writeFileSync(hook, `#!/bin/sh\nprintf 'const t = "%s"\\n' "${TOKEN}" > late.ts\ngit add late.ts\n`)
    chmodSync(hook, 0o755)
    write('b.ts', CLEAN)
    git('add', 'b.ts')
    const before = git('rev-parse', 'HEAD')

    const result = await bridge().commit('t', 'hooked')
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/^A Git hook changed the commit after the check\./)
    expect(git('rev-parse', 'HEAD')).toBe(before)
    // The hook's change stays staged, so nothing is lost.
    expect(git('diff', '--cached', '--name-only')).toBe('b.ts\nlate.ts')
  })
})

describe('blob reading', () => {
  it('finds a token in binary content and on a line that imitates a batch header', async () => {
    // A NUL byte first, then a token: binary content is still scanned.
    writeFileSync(join(dir, 'blob.bin'), Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from(` ${TOKEN} `)]))
    write('b.ts', CLEAN + 'more\n')
    git('add', 'blob.bin', 'b.ts')
    const ids = git('ls-files', '-s', 'b.ts').split(' ')[1]!
    // A line in a.ts shaped like the next object's header, with the token after it.
    write('a.ts', `${CLEAN}\n${ids} blob 99 ${TOKEN}\n`)
    git('add', 'a.ts')
    const report = (await bridge().secretCheck('t', 'commit')).report
    expect(report.findings.map((finding) => finding.location).sort()).toEqual(['a.ts', 'blob.bin'])
    expect(report.complete).toBe(true)
  })
})

describe('push admission', () => {
  it('finds a secret a later commit removed, and leaves the remote alone', async () => {
    git('switch', '-q', '-c', 'feature')
    write('a.ts', `const t = "${TOKEN}"\n`)
    git('commit', '-q', '-am', 'add')
    write('a.ts', CLEAN)
    git('commit', '-q', '-am', 'remove')

    const result = await bridge().push('t')
    expect(result).toMatchObject({ ok: false, secretCheck: { operation: 'push', reason: 'findings' } })
    expect(admitted[0]!.destination).toBe(`${origin} refs/heads/feature`)
    expect(admitted[0]!.report.limits.join(' ')).toContain('no branch with this name')
    expect(execFileSync('git', ['branch', '--list'], { cwd: origin, encoding: 'utf8' })).not.toContain('feature')
  })

  it('checks only what the remote does not have', async () => {
    enabled = false
    write('a.ts', `const t = "${TOKEN}"\n`)
    git('commit', '-q', '-am', 'already published')
    git('push', '-q', 'origin', 'main')
    enabled = true
    write('b.ts', CLEAN)
    git('add', 'b.ts')
    git('commit', '-q', '-m', 'clean')
    expect(await bridge().push('t')).toEqual({ ok: true })
    expect(execFileSync('git', ['rev-parse', 'main'], { cwd: origin, encoding: 'utf8' }).trim()).toBe(
      git('rev-parse', 'HEAD'),
    )
  })

  it('reads the annotated tags push.followTags would send', async () => {
    git('config', 'push.followTags', 'true')
    write('b.ts', CLEAN)
    git('add', 'b.ts')
    git('commit', '-q', '-m', 'clean')
    git('tag', '-a', 'v1', '-m', 'Release notes')
    expect(await bridge().push('t')).toEqual({ ok: true })
    expect(execFileSync('git', ['tag', '--list'], { cwd: origin, encoding: 'utf8' }).trim()).toBe('v1')

    write('c.ts', CLEAN)
    git('add', 'c.ts')
    git('commit', '-q', '-m', 'more')
    git('tag', '-a', 'v2', '-m', `deploy with ${TOKEN}`)
    const refused = await bridge().push('t')
    expect(refused.secretCheck?.reason).toBe('findings')
    expect(refused.reason).toMatch(/npm-token at refs\/tags\/v2:\d+/)
  })

  it('is incomplete without a remote', async () => {
    write('b.ts', CLEAN)
    git('add', 'b.ts')
    git('commit', '-q', '-m', 'clean')
    git('remote', 'remove', 'origin')
    expect((await bridge().push('t')).secretCheck?.reason).toBe('incomplete')
  })
})

describe('manual check', () => {
  it('reports without admitting, with blocking off', async () => {
    enabled = false
    write('a.ts', `const t = "${TOKEN}"\n`)
    const report = await bridge().secretCheck('t', 'commit')
    expect(report.report.counts.high).toBe(1)
    expect(admitted).toEqual([])
  })
})

describe('changedBlobs', () => {
  it('keeps added and modified blobs, and drops deletions and submodules', () => {
    const id = (n: number) => String(n).repeat(40)
    const record = (mode: string, status: string, path: string, n: number) =>
      `:100644 ${mode} ${id(0)} ${id(n)} ${status}\0${path}\0`
    expect(
      changedBlobs(
        record('100644', 'A', 'a', 1) +
          record('100644', 'M', 'b c', 2) +
          record('000000', 'D', 'd', 0) +
          record('160000', 'M', 'sub', 3),
      ),
    ).toEqual([
      { id: id(1), path: 'a' },
      { id: id(2), path: 'b c' },
    ])
  })
})
