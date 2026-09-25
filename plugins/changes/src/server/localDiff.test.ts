import { execFileSync } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import gitdiffParser from 'gitdiff-parser'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { synth } from '@acorn/plugin-api/ui/diff'
import {
  abortArgs,
  abortOperation,
  commitArgs,
  commitStaged,
  discardFile,
  fetchRemote,
  headCommit,
  isValidRelPath,
  localDiff,
  localNewSideText,
  localStatus,
  mergeNumstat,
  parsePorcelainV2,
  pathChunks,
  pullArgs,
  pullRemote,
  pushArgs,
  pushBranch,
  stageFiles,
  stripToHunks,
  unstageFiles,
} from './localDiff'

describe('parsePorcelainV2 (pure)', () => {
  it('parses modified/added/deleted/untracked with staged split', () => {
    const { changes: out } = parsePorcelainV2(
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
      { path: 'src/mod.ts', status: 'modified', staged: false, additions: null, deletions: null, contentKey: '100644 100644 def' },
      { path: 'src/staged-new.ts', status: 'added', staged: true, additions: null, deletions: null, contentKey: '000000 100644 000 def' },
      { path: 'src/gone.ts', status: 'deleted', staged: false, additions: null, deletions: null, contentKey: '100644 000000 abc' },
      { path: 'src/both.ts', status: 'modified', staged: true, additions: null, deletions: null, contentKey: '100644 100644 abc def' },
      { path: 'src/both.ts', status: 'modified', staged: false, additions: null, deletions: null, contentKey: '100644 100644 def' },
      { path: 'notes.md', status: 'untracked', staged: false, additions: null, deletions: null, contentKey: '' },
    ])
  })
  it('parses renames with the orig path', () => {
    const { changes: out } = parsePorcelainV2('2 R. N... 100644 100644 100644 abc abc R100 src/new-name.ts\tsrc/old-name.ts')
    expect(out).toEqual([
      { path: 'src/new-name.ts', oldPath: 'src/old-name.ts', status: 'renamed', staged: true, additions: null, deletions: null, contentKey: '100644 100644 abc abc src/old-name.ts' },
    ])
  })
  it('keys each entry by the objects on its line, and a submodule not at all', () => {
    // A submodule's new commit is not on its line, so no key could see it move.
    expect(parsePorcelainV2('1 .M SC.. 160000 160000 160000 abc abc vendor/lib').changes[0]?.contentKey).toBeUndefined()
    expect(parsePorcelainV2('1 .M N... 100644 100755 100755 abc abc a.ts').changes[0]?.contentKey).toBe('100755 100755 abc')
  })
  it('merges numstat per scope', () => {
    const { changes } = parsePorcelainV2('1 .M N... 100644 100644 100644 abc def a.ts')
    const merged = mergeNumstat(changes, '3\t1\ta.ts', false)
    expect(merged[0]).toMatchObject({ additions: 3, deletions: 1 })
    // Binary files report '-'.
    expect(mergeNumstat(changes, '-\t-\ta.ts', false)[0]).toMatchObject({ additions: null, deletions: null })
  })
})

// The four `# branch.*` headers the parser used to skip. Every later region of the panel reads them,
// and the difference between null and zero is the difference between "no upstream" and "level with
// it", which the remote bar says two different things about.
describe('the branch headers', () => {
  const HEADERS = [
    '# branch.oid 1111111111111111111111111111111111111111',
    '# branch.head james/vnext',
    '# branch.upstream origin/james/vnext',
    '# branch.ab +2 -5',
  ]

  it('reads the branch, its upstream and how far each way', () => {
    expect(parsePorcelainV2([...HEADERS, '1 .M N... 100644 100644 100644 abc def a.ts', ''].join('\n'))).toEqual({
      branch: 'james/vnext',
      upstream: 'origin/james/vnext',
      ahead: 2,
      behind: 5,
      changes: [{ path: 'a.ts', status: 'modified', staged: false, additions: null, deletions: null, contentKey: '100644 100644 def' }],
    })
  })

  it('gives nulls, not zeros, when the branch has no upstream', () => {
    const parsed = parsePorcelainV2(HEADERS.slice(0, 2).join('\n'))
    expect(parsed).toMatchObject({ branch: 'james/vnext', upstream: null, ahead: null, behind: null })
  })

  it('reads a detached HEAD as no branch, the way core does', () => {
    expect(parsePorcelainV2('# branch.head (detached)').branch).toBeNull()
  })

  it('reads nothing out of output that has no headers at all', () => {
    expect(parsePorcelainV2('? notes.md')).toMatchObject({ branch: null, upstream: null, ahead: null, behind: null })
  })
})

describe('an unmerged file', () => {
  // `u XY sub m1 m2 m3 mW h1 h2 h3 path`
  const LINE = 'u UU N... 100644 100644 100644 100644 aaa bbb ccc src/clash.ts'

  it('is conflicted rather than modified, and never staged', () => {
    expect(parsePorcelainV2(LINE).changes).toEqual([
      { path: 'src/clash.ts', status: 'conflicted', staged: false, additions: null, deletions: null, contentKey: '100644 100644 100644 100644 aaa bbb ccc' },
    ])
  })

  it('takes no line counts, even when git offers some', () => {
    const { changes } = parsePorcelainV2(LINE)
    expect(mergeNumstat(changes, '9\t9\tsrc/clash.ts', false)[0]).toMatchObject({ additions: null, deletions: null })
  })
})

describe('commitArgs (pure)', () => {
  it('is a bare commit with nothing set', () => {
    expect(commitArgs('subject')).toEqual(['commit', '-m', 'subject'])
  })

  // The order is the behaviour under test: git takes these flags in any order, so a test that pins one
  // is the only way a reader can tell which one they will see in a shell history.
  it('spells every flag once, in the order the panel offers them', () => {
    expect(commitArgs('subject', { all: true, amend: true, signoff: true, noVerify: true }))
      .toEqual(['commit', '-a', '--amend', '--signoff', '--no-verify', '-m', 'subject'])
  })

  it('leaves out the flags nobody set', () => {
    expect(commitArgs('subject', { all: false, amend: true })).toEqual(['commit', '--amend', '-m', 'subject'])
  })
})

// The remote verbs' argv, pinned the way `commitArgs` is: git takes most of these in any order, so a
// test is the only way a reader can tell which line they will find in a shell history. And two of
// them are the difference between a safe verb and a destructive one.
describe('the remote argv (pure)', () => {
  it('pulls fast-forward only unless the reader asked for the rebase', () => {
    expect(pullArgs()).toEqual(['pull', '--ff-only'])
    expect(pullArgs({ rebase: false })).toEqual(['pull', '--ff-only'])
    expect(pullArgs({ rebase: true })).toEqual(['pull', '--rebase'])
  })

  // `--set-upstream` on every push, which is what makes Publish and Push one call. `--force-with-lease`
  // and never a bare `--force` (docs/security.md § Process, path, and configuration controls).
  it('pushes with an upstream always, and with a lease when forced', () => {
    expect(pushArgs()).toEqual(['push', '--set-upstream', 'origin', 'HEAD'])
    expect(pushArgs({ force: true })).toEqual(['push', '--force-with-lease', '--set-upstream', 'origin', 'HEAD'])
    expect(pushArgs({ force: true }).includes('--force')).toBe(false)
  })

  it('aborts whichever operation it is told about', () => {
    expect(abortArgs('rebase')).toEqual(['rebase', '--abort'])
    expect(abortArgs('merge')).toEqual(['merge', '--abort'])
  })
})

describe('pathChunks', () => {
  it('splits a folder-sized selection into whole batches, the last one short', () => {
    const paths = Array.from({ length: 450 }, (_, at) => `src/f${at}.ts`)
    expect(pathChunks(paths, 200).map((chunk) => chunk.length)).toEqual([200, 200, 50])
    expect(pathChunks(paths, 200).flat()).toEqual(paths)
    expect(pathChunks([], 200)).toEqual([])
    expect(pathChunks(['a.ts'], 200)).toEqual([['a.ts']])
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

  // Fixture built once and copied per test: these assertions need real git (renames via `git mv`,
  // staged-versus-worktree diffs, commit contents) but not six git spawns of setup per case.
  let template: string

  beforeAll(() => {
    template = mkdtempSync(join(tmpdir(), 'acorn-ldiff-template-'))
    const g = (...args: string[]) => execFileSync('git', ['-C', template, ...args], { stdio: 'pipe' })
    execFileSync('git', ['init', '-q', '-b', 'main', template])
    g('config', 'user.email', 't@t.test')
    g('config', 'user.name', 'T')
    mkdirSync(join(template, 'src'))
    writeFileSync(join(template, 'src', 'a.ts'), 'line1\nline2\nline3\n')
    g('add', '.')
    g('commit', '-q', '-m', 'init')
  })

  afterAll(() => rmSync(template, { recursive: true, force: true }))

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'acorn-ldiff-'))
    cpSync(template, dir, { recursive: true })
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('modified file → LocalChange + a patch the existing diff parser accepts', async () => {
    writeFileSync(join(dir, 'src', 'a.ts'), 'line1\nCHANGED\nline3\n')
    const { changes } = await localStatus(dir)
    expect(changes).toEqual([{ path: 'src/a.ts', status: 'modified', staged: false, additions: 1, deletions: 1, contentKey: expect.any(String) }])
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
    const { changes } = await localStatus(dir)
    expect(changes).toEqual([{ path: 'new.md', status: 'untracked', staged: false, additions: null, deletions: null, contentKey: expect.any(String) }])
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
    const { changes } = await localStatus(dir)
    const rename = changes.find((c) => c.status === 'renamed')
    expect(rename?.path).toBe('src/b.ts')
    expect(rename?.oldPath).toBe('src/a.ts')
  })

  it('localNewSideText reads the working tree unstaged and the index staged', async () => {
    writeFileSync(join(dir, 'src', 'a.ts'), 'line1\nSTAGED\nline3\n')
    await stageFiles(dir, ['src/a.ts'])
    // Now the three sides differ: HEAD has line2, the index has STAGED, the file on disk has DIRTY.
    writeFileSync(join(dir, 'src', 'a.ts'), 'line1\nDIRTY\nline3\n')

    expect((await localNewSideText(dir, 'src/a.ts', 'unstaged')).text).toBe('line1\nDIRTY\nline3\n')
    expect((await localNewSideText(dir, 'src/a.ts', 'staged')).text).toBe('line1\nSTAGED\nline3\n')
  })

  it('localNewSideText refuses a path out of the worktree and a symlink in it', async () => {
    await expect(localNewSideText(dir, '../etc', 'unstaged')).rejects.toThrow('Invalid path')
    await expect(localNewSideText(dir, '/etc/passwd', 'unstaged')).rejects.toThrow('Invalid path')
    // A repo can hold a symlink pointing anywhere, and this path arrives over HTTP.
    symlinkSync('/etc/passwd', join(dir, 'src', 'link.ts'))
    await expect(localNewSideText(dir, 'src/link.ts', 'unstaged')).rejects.toThrow('Not a regular file')
  })

  // About 15 sequential git spawns, over vitest's 5s default on a busy machine.
  it('stage/unstage/discard/commit land the reviewed work (docs/panes.md)', { timeout: 15_000 }, async () => {
    // stage → commit
    writeFileSync(join(dir, 'src', 'a.ts'), 'line1\nCOMMIT ME\nline3\n')
    expect(await stageFiles(dir, ['src/a.ts'])).toEqual({ ok: true })
    expect((await localStatus(dir)).changes[0]).toMatchObject({ staged: true })
    expect(await commitStaged(dir, 'feat: change a')).toEqual({ ok: true })
    expect((await localStatus(dir)).changes).toEqual([])
    expect(git('log', '-1', '--pretty=%s').trim()).toBe('feat: change a')
    expect(git('show', 'HEAD:src/a.ts')).toContain('COMMIT ME')

    // unstage
    writeFileSync(join(dir, 'src', 'a.ts'), 'line1\nUNSTAGE\nline3\n')
    await stageFiles(dir, ['src/a.ts'])
    expect(await unstageFiles(dir, ['src/a.ts'])).toEqual({ ok: true })
    expect((await localStatus(dir)).changes[0]).toMatchObject({ staged: false })

    // discard tracked (post-confirm path)
    expect(await discardFile(dir, 'src/a.ts', false)).toEqual({ ok: true })
    expect((await localStatus(dir)).changes).toEqual([])
    expect(git('show', 'HEAD:src/a.ts')).not.toContain('UNSTAGE')

    // discard untracked = clean
    writeFileSync(join(dir, 'junk.txt'), 'x')
    expect(await discardFile(dir, 'junk.txt', true)).toEqual({ ok: true })
    expect((await localStatus(dir)).changes).toEqual([])

    // guards
    expect((await stageFiles(dir, ['../evil'])).ok).toBe(false)
    expect((await stageFiles(dir, [])).ok).toBe(false)
    expect((await commitStaged(dir, '  ')).ok).toBe(false)
    expect((await commitStaged(dir, 'nothing staged')).ok).toBe(false) // git refuses an empty commit
  })

  // A file staged for the first time: a worktree-only restore rewrote it from the index, which is
  // where the staged copy was, so the row never went away.
  it('discards a staged add', { timeout: 15_000 }, async () => {
    writeFileSync(join(dir, 'fresh.ts'), 'brand new\n')
    await stageFiles(dir, ['fresh.ts'])
    expect(await discardFile(dir, 'fresh.ts', false)).toEqual({ ok: true })
    expect((await localStatus(dir)).changes).toEqual([])
    expect(existsSync(join(dir, 'fresh.ts'))).toBe(false)
  })

  // A rename is two names, and discarding only the new one leaves the old one deleted.
  it('discards both halves of a rename', { timeout: 15_000 }, async () => {
    git('mv', 'src/a.ts', 'src/moved.ts')
    expect((await localStatus(dir)).changes[0]).toMatchObject({ path: 'src/moved.ts', oldPath: 'src/a.ts' })
    expect(await discardFile(dir, 'src/moved.ts', false, 'src/a.ts')).toEqual({ ok: true })
    expect((await localStatus(dir)).changes).toEqual([])
    expect(existsSync(join(dir, 'src', 'a.ts'))).toBe(true)
  })

  // `git commit -a` is what the Commit tracked button asks for: every tracked change, and nothing
  // untracked. Amend on top of it rewrites the commit rather than adding one.
  it('commits tracked changes with -a, leaves untracked files alone, and amends in place', { timeout: 15_000 }, async () => {
    writeFileSync(join(dir, 'src', 'a.ts'), 'line1\nTRACKED\nline3\n')
    writeFileSync(join(dir, 'stray.txt'), 'not mine\n')
    const before = git('rev-list', '--count', 'HEAD').trim()

    expect(await commitStaged(dir, 'feat: all tracked', { all: true })).toEqual({ ok: true })
    expect(git('show', 'HEAD:src/a.ts')).toContain('TRACKED')
    // Still untracked, so the commit walked past it.
    expect((await localStatus(dir)).changes).toEqual([
      { path: 'stray.txt', status: 'untracked', staged: false, additions: null, deletions: null, contentKey: expect.any(String) },
    ])
    expect(Number(git('rev-list', '--count', 'HEAD').trim())).toBe(Number(before) + 1)

    // The amend keeps the count where it was and takes the new subject.
    expect(await commitStaged(dir, 'feat: reworded', { amend: true, signoff: true })).toEqual({ ok: true })
    expect(Number(git('rev-list', '--count', 'HEAD').trim())).toBe(Number(before) + 1)
    expect(git('log', '-1', '--pretty=%s').trim()).toBe('feat: reworded')
    expect(git('log', '-1', '--pretty=%b')).toContain('Signed-off-by:')

    // Refused here rather than by git, which would answer with its commit-template help instead.
    expect(await commitStaged(dir, '   ', { amend: true })).toEqual({ ok: false, reason: 'Commit message required.' })

    await discardFile(dir, 'stray.txt', true)
  })

  it('reads HEAD\'s hash and whole message for the field an amend fills', async () => {
    const head = await headCommit(dir)
    expect(head?.sha).toMatch(/^[0-9a-f]{40}$/)
    expect(head?.message).toBe(git('log', '-1', '--pretty=%B').replace(/\n+$/, ''))
  })

  // More paths than one `git add` should carry, which is why staging chunks. A small chunk size makes
  // the batching real without writing 450 files.
  it('stages more paths than fit one call, in batches', { timeout: 15_000 }, async () => {
    const paths = Array.from({ length: 25 }, (_, at) => `src/bulk-${at}.ts`)
    for (const path of paths) writeFileSync(join(dir, path), `export const n = ${path.length}\n`)
    expect(await stageFiles(dir, paths, 10)).toEqual({ ok: true })
    const staged = (await localStatus(dir)).changes.filter((c) => c.staged).map((c) => c.path)
    expect(staged.sort()).toEqual([...paths].sort())
    expect(await unstageFiles(dir, paths, 10)).toEqual({ ok: true })
    expect((await localStatus(dir)).changes.every((c) => !c.staged)).toBe(true)
  })

  // The panel's branch facts, and the operation check beside them.
  it('reports the branch, the absent upstream and no operation in flight', async () => {
    const status = await localStatus(dir)
    expect(status).toMatchObject({ branch: 'main', upstream: null, ahead: null, behind: null, operation: null })
  })

  it('sees a merge in flight through the worktree\'s real git directory', async () => {
    // A conflicting commit on each side of a fork, so `git merge` stops mid-flight.
    git('checkout', '-q', '-b', 'other')
    writeFileSync(join(dir, 'src', 'a.ts'), 'line1\nTHEIRS\nline3\n')
    git('commit', '-q', '-am', 'theirs')
    git('checkout', '-q', 'main')
    writeFileSync(join(dir, 'src', 'a.ts'), 'line1\nOURS\nline3\n')
    git('commit', '-q', '-am', 'ours')
    try {
      git('merge', 'other')
    } catch {
      // A conflicting merge exits non-zero. That is the state under test.
    }

    const status = await localStatus(dir)
    expect(status.operation).toBe('merge')
    const clash = status.changes.find((c) => c.path === 'src/a.ts')
    expect(clash).toEqual({ path: 'src/a.ts', status: 'conflicted', staged: false, additions: null, deletions: null, contentKey: expect.any(String) })

    // Git's own answer to "stage a conflict" is "mark it resolved".
    expect(await stageFiles(dir, ['src/a.ts'])).toEqual({ ok: true })
    expect((await localStatus(dir)).changes.find((c) => c.path === 'src/a.ts')).toMatchObject({ status: 'modified', staged: true })
  })

  // The pane re-reads a file's patch only when this key moves (DiffSource.contentKey), so it has to
  // stay put across a read that changed nothing and move for every change a patch can show.
  describe('contentKey', () => {
    const keyOf = async (path: string, staged: boolean) =>
      (await localStatus(dir)).changes.find((c) => c.path === path && c.staged === staged)?.contentKey

    it('holds still across reads of a tree nobody touched, and moves for a same-size edit', async () => {
      writeFileSync(join(dir, 'src', 'a.ts'), 'line1\nEDITED\nline3\n')
      writeFileSync(join(dir, 'new.md'), 'hello\n')
      const before = await localStatus(dir)
      expect(before.changes.every((c) => typeof c.contentKey === 'string')).toBe(true)
      expect((await localStatus(dir)).changes).toEqual(before.changes)

      // Same length, same line counts: only the stat can see it.
      writeFileSync(join(dir, 'src', 'a.ts'), 'line1\nEDITEX\nline3\n')
      const after = await localStatus(dir)
      const a = (status: typeof before) => status.changes.find((c) => c.path === 'src/a.ts')
      const md = (status: typeof before) => status.changes.find((c) => c.path === 'new.md')
      expect(a(after)).toMatchObject({ additions: 1, deletions: 1 })
      expect(a(after)?.contentKey).not.toBe(a(before)?.contentKey)
      expect(md(after)?.contentKey).toBe(md(before)?.contentKey)
    })

    it('moves for a mode change', async () => {
      writeFileSync(join(dir, 'src', 'a.ts'), 'line1\nEDITED\nline3\n')
      const before = await keyOf('src/a.ts', false)
      chmodSync(join(dir, 'src', 'a.ts'), 0o755)
      expect(await keyOf('src/a.ts', false)).not.toBe(before)
    })

    it('follows the index for staging, and survives a commit that leaves the working-tree patch alone', { timeout: 15_000 }, async () => {
      const file = join(dir, 'src', 'a.ts')
      writeFileSync(file, 'line1\nONE\nline3\n')
      await stageFiles(dir, ['src/a.ts'])
      writeFileSync(file, 'line1\nTWO\nline3\n')
      const staged = await keyOf('src/a.ts', true)
      const unstaged = await keyOf('src/a.ts', false)

      // Staging the second edit moves the index: the staged patch changed, and so did what the
      // working tree is compared against. The file on disk did not change.
      await stageFiles(dir, ['src/a.ts'])
      writeFileSync(file, 'line1\nTHREE\nline3\n')
      const staged2 = await keyOf('src/a.ts', true)
      const unstaged2 = await keyOf('src/a.ts', false)
      expect(staged2).not.toBe(staged)
      expect(unstaged2).not.toBe(unstaged)

      // Committing moves HEAD to the index. The unstaged patch is the index against the disk, and
      // neither moved, so neither does its key.
      expect(await commitStaged(dir, 'feat: two')).toEqual({ ok: true })
      expect(await keyOf('src/a.ts', true)).toBeUndefined()
      expect(await keyOf('src/a.ts', false)).toBe(unstaged2)

      // Unstaging after a second stage puts the index back, which the working-tree side sees.
      await stageFiles(dir, ['src/a.ts'])
      await unstageFiles(dir, ['src/a.ts'])
      expect(await keyOf('src/a.ts', false)).toBe(unstaged2)
    })

    it('names the old path of a rename', async () => {
      git('mv', 'src/a.ts', 'src/b.ts')
      expect(await keyOf('src/b.ts', true)).toMatch(/ src\/a\.ts$/)
    })
  })

  it('stripToHunks drops the git header only', () => {
    expect(stripToHunks('diff --git a/x b/x\nindex 1..2\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n')).toBe('@@ -1 +1 @@\n-a\n+b\n')
    expect(stripToHunks('@@ -1 +1 @@\n-a\n+b\n')).toBe('@@ -1 +1 @@\n-a\n+b\n')
    expect(stripToHunks('')).toBe('')
  })
})

// The four remote verbs against a real origin, which is a bare repository in a temp directory: no
// network, no credentials, and the same argv a real remote sees. The pure builders above pin the
// flags; this pins what git does with them, including the two refusals the panel turns into a next
// step.
describe('the remote verbs over a real origin', () => {
  let origin: string
  let dir: string
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
  const identify = (at: string) => {
    execFileSync('git', ['config', 'user.email', 'test@acorn.dev'], { cwd: at })
    execFileSync('git', ['config', 'user.name', 'Acorn Test'], { cwd: at })
  }

  beforeEach(() => {
    origin = mkdtempSync(join(tmpdir(), 'acorn-origin-'))
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main'], { cwd: origin })
    dir = mkdtempSync(join(tmpdir(), 'acorn-clone-'))
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir })
    identify(dir)
    writeFileSync(join(dir, 'a.txt'), 'one\n', 'utf8')
    git('add', 'a.txt')
    git('commit', '-q', '-m', 'first')
    git('remote', 'add', 'origin', origin)
  })
  afterEach(() => {
    rmSync(origin, { recursive: true, force: true })
    rmSync(dir, { recursive: true, force: true })
  })

  /** A second working copy of the same origin, for the commits somebody else pushes. */
  const otherClone = () => {
    const other = mkdtempSync(join(tmpdir(), 'acorn-other-'))
    execFileSync('git', ['clone', '-q', origin, other], { cwd: tmpdir() })
    identify(other)
    return {
      path: other,
      commit: (text: string) => {
        writeFileSync(join(other, 'b.txt'), text, 'utf8')
        execFileSync('git', ['add', 'b.txt'], { cwd: other })
        execFileSync('git', ['commit', '-q', '-m', `theirs: ${text.trim()}`], { cwd: other })
        execFileSync('git', ['push', '-q', 'origin', 'HEAD:main'], { cwd: other })
      },
      cleanup: () => rmSync(other, { recursive: true, force: true }),
    }
  }

  it('publishes a branch that has no upstream, and the status read says so afterwards', { timeout: 30_000 }, async () => {
    expect(await localStatus(dir)).toMatchObject({ upstream: null, ahead: null, behind: null })

    expect(await pushBranch(dir)).toEqual({ ok: true })
    // Publish and Push are the same call: `--set-upstream` is what turns the nulls into counts.
    expect(await localStatus(dir)).toMatchObject({ upstream: 'origin/main', ahead: 0, behind: 0 })
  })

  it('counts a commit as ahead, sends it, and comes back level', { timeout: 30_000 }, async () => {
    await pushBranch(dir)
    writeFileSync(join(dir, 'a.txt'), 'two\n', 'utf8')
    git('commit', '-q', '-am', 'second')
    expect(await localStatus(dir)).toMatchObject({ ahead: 1, behind: 0 })

    expect(await pushBranch(dir)).toEqual({ ok: true })
    expect(await localStatus(dir)).toMatchObject({ ahead: 0, behind: 0 })
  })

  it('sees somebody else\'s commit after a fetch and fast-forwards onto it', { timeout: 30_000 }, async () => {
    await pushBranch(dir)
    const other = otherClone()
    other.commit('theirs\n')
    // Nothing local moved, so only a fetch can tell. That is why Fetch is the verb offered in sync.
    expect(await localStatus(dir)).toMatchObject({ ahead: 0, behind: 0 })

    expect(await fetchRemote(dir)).toEqual({ ok: true })
    expect(await localStatus(dir)).toMatchObject({ ahead: 0, behind: 1 })

    expect(await pullRemote(dir)).toEqual({ ok: true })
    expect(await localStatus(dir)).toMatchObject({ ahead: 0, behind: 0 })
    other.cleanup()
  })

  it('refuses a fast-forward pull on a diverged branch, and rebases when asked', { timeout: 30_000 }, async () => {
    await pushBranch(dir)
    const other = otherClone()
    other.commit('theirs\n')
    writeFileSync(join(dir, 'a.txt'), 'mine\n', 'utf8')
    git('commit', '-q', '-am', 'mine')
    await fetchRemote(dir)
    expect(await localStatus(dir)).toMatchObject({ ahead: 1, behind: 1 })

    // The reason the client turns into "Use Pull with rebase from the menu" (client/model.ts
    // § remoteReason).
    expect(await pullRemote(dir)).toMatchObject({ ok: false, reason: expect.stringMatching(/fast-forward/i) })

    expect(await pullRemote(dir, { rebase: true })).toEqual({ ok: true })
    expect(await localStatus(dir)).toMatchObject({ ahead: 1, behind: 0 })
    other.cleanup()
  })

  // The story phase 2 left for this phase: after an amend the branch is ahead of an upstream that
  // still holds the old commit, so a plain push is rejected and Force push is the next step.
  it('rejects a push after an amend, and lets the leased force through', { timeout: 30_000 }, async () => {
    await pushBranch(dir)
    writeFileSync(join(dir, 'a.txt'), 'two\n', 'utf8')
    git('commit', '-q', '-am', 'second')
    await pushBranch(dir)

    expect(await commitStaged(dir, 'second, reworded', { amend: true })).toEqual({ ok: true })
    expect(await pushBranch(dir)).toMatchObject({ ok: false, reason: expect.stringMatching(/rejected|non-fast-forward/i) })

    // The lease holds because this node's remote-tracking ref is what the remote actually has.
    expect(await pushBranch(dir, { force: true })).toEqual({ ok: true })
    expect(await localStatus(dir)).toMatchObject({ ahead: 0, behind: 0 })
    expect(git('log', '-1', '--pretty=%s').trim()).toBe('second, reworded')
  })

  it('refuses a leased force when the remote has moved since the last fetch', { timeout: 30_000 }, async () => {
    await pushBranch(dir)
    const other = otherClone()
    other.commit('theirs\n')
    // No fetch, so this node's idea of origin/main is stale — which is precisely what the lease is
    // for. A bare `--force` would have dropped their commit here.
    writeFileSync(join(dir, 'a.txt'), 'mine\n', 'utf8')
    git('commit', '-q', '-am', 'mine')

    expect(await pushBranch(dir, { force: true })).toMatchObject({ ok: false, reason: expect.stringMatching(/stale info|rejected/i) })
    other.cleanup()
  })

  it('aborts a rebase that stopped on a conflict and puts the branch back', { timeout: 30_000 }, async () => {
    await pushBranch(dir)
    const other = otherClone()
    // Both sides change the same line, so the rebase stops.
    execFileSync('git', ['fetch', '-q'], { cwd: dir })
    writeFileSync(join(other.path, 'a.txt'), 'theirs\n', 'utf8')
    execFileSync('git', ['commit', '-q', '-am', 'theirs'], { cwd: other.path })
    execFileSync('git', ['push', '-q', 'origin', 'HEAD:main'], { cwd: other.path })
    writeFileSync(join(dir, 'a.txt'), 'mine\n', 'utf8')
    git('commit', '-q', '-am', 'mine')
    const mine = git('rev-parse', 'HEAD').trim()

    expect((await pullRemote(dir, { rebase: true })).ok).toBe(false)
    expect(await localStatus(dir)).toMatchObject({ operation: 'rebase' })

    expect(await abortOperation(dir, 'rebase')).toEqual({ ok: true })
    expect(await localStatus(dir)).toMatchObject({ operation: null })
    expect(git('rev-parse', 'HEAD').trim()).toBe(mine)
    other.cleanup()
  })
})
