import { describe, expect, it } from 'vitest'
import type { LocalChange } from '@acorn/protocol/terminal.ts'
import {
  buildCommitPrompt, cleanCommitMessage, commitDiffScope, commitFiles, splitByBudget, splitPatch,
} from './commitMessage'

// The prompt behind the commit editor's wand, entirely without a provider. Every function here is
// pure, which is the point: the budget rule and the wording are the parts most likely to go wrong and
// the parts a live generate would never show you.

const change = (path: string, over: Partial<LocalChange> = {}): LocalChange => ({
  path,
  status: 'modified',
  staged: false,
  additions: 1,
  deletions: 0,
  ...over,
})

describe('which diff describes the commit', () => {
  it('follows the commit button: the index when something is staged, every tracked change when not', () => {
    expect(commitDiffScope([change('a.ts', { staged: true }), change('b.ts')])).toBe('staged')
    expect(commitDiffScope([change('a.ts'), change('b.ts')])).toBe('tracked')
  })

  it('refuses a tree with nothing a commit would take, before any provider call', () => {
    expect(commitDiffScope([])).toBe(null)
    // `git commit -a` leaves untracked files where they are, so a tree of them has nothing to describe.
    expect(commitDiffScope([change('new.ts', { status: 'untracked' })])).toBe(null)
    // A conflict is a resolution job, not a description job.
    expect(commitDiffScope([change('both.ts', { status: 'conflicted' })])).toBe(null)
  })

  it('collapses a file staged and then edited again into one path', () => {
    const files = commitFiles([change('a.ts', { staged: true }), change('a.ts')], 'staged')
    expect(files.map((file) => file.path)).toEqual(['a.ts'])
  })
})

describe('the budget rule', () => {
  const sized = (path: string, lines: number) => change(path, { additions: lines, deletions: 0 })

  it('includes small files whole and lists the rest, smallest first', () => {
    const files = commitFiles([sized('big.ts', 400), sized('small.ts', 2), sized('middling.ts', 40)], 'tracked')
    expect(files.map((file) => file.path)).toEqual(['small.ts', 'middling.ts', 'big.ts'])
    // 3,000 characters buys the two small files and not the 400-line one.
    const { include, omit } = splitByBudget(files, 3_000)
    expect(include.map((file) => file.path)).toEqual(['small.ts', 'middling.ts'])
    expect(omit.map((file) => file.path)).toEqual(['big.ts'])
  })

  it('always includes the first file, so one enormous file is still read and trimmed', () => {
    const { include, omit } = splitByBudget(commitFiles([sized('huge.ts', 90_000)], 'tracked'), 3_000)
    expect(include.map((file) => file.path)).toEqual(['huge.ts'])
    expect(omit).toEqual([])
  })

  it('sorts a file git could not count last rather than first', () => {
    const files = commitFiles([change('logo.png', { additions: null, deletions: null }), sized('a.ts', 10)], 'tracked')
    expect(files.map((file) => file.path)).toEqual(['a.ts', 'logo.png'])
  })
})

describe('one git diff, back apart per file', () => {
  const diff = [
    'diff --git a/a.ts b/a.ts',
    'index 111..222 100644',
    '--- a/a.ts',
    '+++ b/a.ts',
    '@@ -1 +1 @@',
    '-one',
    '+two',
    'diff --git a/gone.ts b/gone.ts',
    'deleted file mode 100644',
    '--- a/gone.ts',
    '+++ /dev/null',
    '@@ -1 +0,0 @@',
    '-was here',
    '',
  ].join('\n')

  it('keys each patch by the name the file has after the commit', () => {
    const patches = splitPatch(diff)
    expect([...patches.keys()]).toEqual(['a.ts', 'gone.ts'])
    expect(patches.get('a.ts')).toContain('+two')
    expect(patches.get('a.ts')).not.toContain('was here')
  })

  it('answers nothing for a patch with no files in it', () => {
    expect(splitPatch('').size).toBe(0)
  })
})

describe('the prompt', () => {
  const files = commitFiles([change('a.ts', { additions: 3, deletions: 1 }), change('b.ts', { additions: 2, deletions: 0 })], 'tracked')
  const patches = new Map([['a.ts', 'diff --git a/a.ts b/a.ts\n@@\n+three'], ['b.ts', 'diff --git a/b.ts b/b.ts\n@@\n+two']])
  // Smallest first, so `b.ts` leads. Named rather than indexed, because the order is the thing under
  // test two blocks up.
  const only = (path: string) => files.filter((file) => file.path === path)

  it('names the branch, which is usually the only sentence of intent anybody wrote down', () => {
    const prompt = buildCommitPrompt({ branch: 'james/fix-empty-header', scope: 'tracked', include: files, omit: [], patches })
    expect(prompt).toContain('Branch: james/fix-empty-header')
    expect(prompt).toContain('Nothing is staged')
    expect(prompt).toContain('- a.ts +3 -1')
    expect(prompt).toContain('+three')
  })

  it('says which commit it is describing when something is staged', () => {
    const prompt = buildCommitPrompt({ branch: 'main', scope: 'staged', include: files, omit: [], patches })
    expect(prompt).toContain('Committing what is in the index.')
  })

  it('answers a detached head rather than an empty line', () => {
    const prompt = buildCommitPrompt({ branch: null, scope: 'tracked', include: [], omit: [], patches: new Map() })
    expect(prompt).toContain('Branch: detached HEAD')
  })

  it('lists the files whose patches did not fit, so the model knows they moved', () => {
    const prompt = buildCommitPrompt({
      branch: 'main', scope: 'tracked', include: only('a.ts'), omit: only('b.ts'), patches,
    })
    expect(prompt).toContain('- b.ts +2 -0')
    expect(prompt).toContain('their patches did not fit')
    expect(prompt).not.toContain('+two')
  })

  it('trims a patch that turns out longer than its line count suggested, and says so', () => {
    const long = new Map([['a.ts', `diff --git a/a.ts b/a.ts\n${'+x'.repeat(500)}`]])
    const prompt = buildCommitPrompt({ branch: 'main', scope: 'tracked', include: only('a.ts'), omit: [], patches: long, budget: 120 })
    expect(prompt).toContain('… patch truncated')
    expect(prompt.length).toBeLessThan(400)
  })
})

describe('what comes back', () => {
  it('unwraps a fence and a fully quoted subject, and leaves an honest message alone', () => {
    expect(cleanCommitMessage('```\nfix: the thing\n```')).toBe('fix: the thing')
    expect(cleanCommitMessage('```text\nfix: the thing\n\nbecause\n```')).toBe('fix: the thing\n\nbecause')
    expect(cleanCommitMessage('  "fix: the thing"  ')).toBe('fix: the thing')
    expect(cleanCommitMessage('fix: honour the "--no-verify" flag')).toBe('fix: honour the "--no-verify" flag')
    expect(cleanCommitMessage('feat: one\n\nA body.\n')).toBe('feat: one\n\nA body.')
  })
})
