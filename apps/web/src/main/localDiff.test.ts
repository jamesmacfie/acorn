import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import gitdiffParser from 'gitdiff-parser'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { synth } from '../client/diff'
import {
  commitStaged,
  discardFile,
  isValidRelPath,
  localChanges,
  localDiff,
  localFileBlob,
  mergeNumstat,
  parsePorcelainV2,
  stageFile,
  stripToHunks,
  unstageFile,
} from './localDiff'

describe('parsePorcelainV2 (pure)', () => {
  it('parses modified/added/deleted/untracked with staged split', () => {
    const out = parsePorcelainV2(
      [
        '1 .M N... 100644 100644 100644 abc def src/mod.ts',
        '1 A. N... 000000 100644 100644 000 def src/staged-new.ts',
        '1 .D N... 100644 100644 000000 abc abc src/gone.ts',
        '1 MM N... 100644 100644 100644 abc def src/both.ts',
        '? notes.md',
        '',
      ].join('\n'),
    )
    expect(out).toEqual([
      { path: 'src/mod.ts', status: 'modified', staged: false, additions: null, deletions: null },
      { path: 'src/staged-new.ts', status: 'added', staged: true, additions: null, deletions: null },
      { path: 'src/gone.ts', status: 'deleted', staged: false, additions: null, deletions: null },
      { path: 'src/both.ts', status: 'modified', staged: true, additions: null, deletions: null },
      { path: 'src/both.ts', status: 'modified', staged: false, additions: null, deletions: null },
      { path: 'notes.md', status: 'untracked', staged: false, additions: null, deletions: null },
    ])
  })
  it('parses renames with the orig path', () => {
    const out = parsePorcelainV2('2 R. N... 100644 100644 100644 abc abc R100 src/new-name.ts\tsrc/old-name.ts')
    expect(out).toEqual([
      { path: 'src/new-name.ts', oldPath: 'src/old-name.ts', status: 'renamed', staged: true, additions: null, deletions: null },
    ])
  })
  it('merges numstat per scope', () => {
    const changes = parsePorcelainV2('1 .M N... 100644 100644 100644 abc def a.ts')
    const merged = mergeNumstat(changes, '3\t1\ta.ts', false)
    expect(merged[0]).toMatchObject({ additions: 3, deletions: 1 })
    // binary files report '-'
    expect(mergeNumstat(changes, '-\t-\ta.ts', false)[0]).toMatchObject({ additions: null, deletions: null })
  })
})

describe('isValidRelPath', () => {
  it('rejects traversal, absolute paths and flag-alikes', () => {
    expect(isValidRelPath('src/a.ts')).toBe(true)
    expect(isValidRelPath('../etc')).toBe(false)
    expect(isValidRelPath('a/../../b')).toBe(false)
    expect(isValidRelPath('/etc/passwd')).toBe(false)
    expect(isValidRelPath('--exec=x')).toBe(false)
    expect(isValidRelPath('')).toBe(false)
  })
})

describe('local diff over a real worktree', () => {
  let dir: string
  const git = (...args: string[]) => execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe' }).toString()

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'acorn-ldiff-'))
    execFileSync('git', ['init', '-q', '-b', 'main', dir])
    git('config', 'user.email', 't@t.test')
    git('config', 'user.name', 'T')
    mkdirSync(join(dir, 'src'))
    writeFileSync(join(dir, 'src', 'a.ts'), 'line1\nline2\nline3\n')
    git('add', '.')
    git('commit', '-q', '-m', 'init')
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('modified file → LocalChange + a patch the existing diff parser accepts', async () => {
    writeFileSync(join(dir, 'src', 'a.ts'), 'line1\nCHANGED\nline3\n')
    const changes = await localChanges(dir)
    expect(changes).toEqual([{ path: 'src/a.ts', status: 'modified', staged: false, additions: 1, deletions: 1 }])
    const { patch } = await localDiff(dir, 'src/a.ts', 'unstaged')
    expect(patch.startsWith('@@')).toBe(true)
    const [file] = gitdiffParser.parse(synth('src/a.ts', patch))
    expect(file.hunks).toHaveLength(1)
    const changed = file.hunks[0].changes
    expect(changed.some((c) => c.type === 'insert' && c.content.includes('CHANGED'))).toBe(true)
    expect(changed.some((c) => c.type === 'delete' && c.content.includes('line2'))).toBe(true)
  })

  it('untracked file renders as an all-additions patch (--no-index exits 1 on success)', async () => {
    writeFileSync(join(dir, 'new.md'), 'hello\nworld\n')
    const changes = await localChanges(dir)
    expect(changes).toEqual([{ path: 'new.md', status: 'untracked', staged: false, additions: null, deletions: null }])
    const { patch } = await localDiff(dir, 'new.md', 'unstaged')
    const [file] = gitdiffParser.parse(synth('new.md', patch))
    expect(file.hunks[0].changes.every((c) => c.type === 'insert')).toBe(true)
    expect(file.hunks[0].changes).toHaveLength(2)
  })

  it('staged scope diffs the index; renames carry oldPath', async () => {
    writeFileSync(join(dir, 'src', 'a.ts'), 'line1\nSTAGED\nline3\n')
    git('add', 'src/a.ts')
    const { patch } = await localDiff(dir, 'src/a.ts', 'staged')
    expect(patch).toContain('+STAGED')
    expect((await localDiff(dir, 'src/a.ts', 'unstaged')).patch).toBe('')

    git('mv', 'src/a.ts', 'src/b.ts')
    const changes = await localChanges(dir)
    const rename = changes.find((c) => c.status === 'renamed')
    expect(rename?.path).toBe('src/b.ts')
    expect(rename?.oldPath).toBe('src/a.ts')
  })

  it('localFileBlob reads the HEAD side and rejects bad refs/paths', async () => {
    writeFileSync(join(dir, 'src', 'a.ts'), 'dirty\n')
    expect((await localFileBlob(dir, 'src/a.ts')).text).toBe('line1\nline2\nline3\n')
    await expect(localFileBlob(dir, '../etc')).rejects.toThrow('Invalid path')
    await expect(localFileBlob(dir, 'src/a.ts', '--evil')).rejects.toThrow('Invalid ref')
  })

  it('stage/unstage/discard/commit land the reviewed work (docs/next 04 P4)', async () => {
    // stage → commit
    writeFileSync(join(dir, 'src', 'a.ts'), 'line1\nCOMMIT ME\nline3\n')
    expect(await stageFile(dir, 'src/a.ts')).toEqual({ ok: true })
    expect((await localChanges(dir))[0]).toMatchObject({ staged: true })
    expect(await commitStaged(dir, 'feat: change a')).toEqual({ ok: true })
    expect(await localChanges(dir)).toEqual([])
    expect(git('log', '-1', '--pretty=%s').trim()).toBe('feat: change a')
    expect(git('show', 'HEAD:src/a.ts')).toContain('COMMIT ME')

    // unstage
    writeFileSync(join(dir, 'src', 'a.ts'), 'line1\nUNSTAGE\nline3\n')
    await stageFile(dir, 'src/a.ts')
    expect(await unstageFile(dir, 'src/a.ts')).toEqual({ ok: true })
    expect((await localChanges(dir))[0]).toMatchObject({ staged: false })

    // discard tracked (post-confirm path)
    expect(await discardFile(dir, 'src/a.ts', false)).toEqual({ ok: true })
    expect(await localChanges(dir)).toEqual([])
    expect(git('show', 'HEAD:src/a.ts')).not.toContain('UNSTAGE')

    // discard untracked = clean
    writeFileSync(join(dir, 'junk.txt'), 'x')
    expect(await discardFile(dir, 'junk.txt', true)).toEqual({ ok: true })
    expect(await localChanges(dir)).toEqual([])

    // guards
    expect((await stageFile(dir, '../evil')).ok).toBe(false)
    expect((await commitStaged(dir, '  ')).ok).toBe(false)
    expect((await commitStaged(dir, 'nothing staged')).ok).toBe(false) // git refuses an empty commit
  })

  it('stripToHunks drops the git header only', () => {
    expect(stripToHunks('diff --git a/x b/x\nindex 1..2\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n')).toBe('@@ -1 +1 @@\n-a\n+b\n')
    expect(stripToHunks('@@ -1 +1 @@\n-a\n+b\n')).toBe('@@ -1 +1 @@\n-a\n+b\n')
    expect(stripToHunks('')).toBe('')
  })
})
