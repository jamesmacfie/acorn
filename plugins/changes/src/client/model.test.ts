import { describe, expect, it } from 'vitest'
import type { LocalChange } from '@acorn/protocol/terminal.ts'
import {
  buildTree, changeKey, commitMode, DEFAULT_CHANGE_VIEW, filesUnder, folderState,
  generateReason, groupChanges, groupSections, isFolderKey, pickSelected, primaryRemote, remoteCounts,
  remoteReason, sortRows, stackFor, stageableRows, stagedState, toPullFile, totals, unstagedPathsOf,
  viewNodes, visibleNodes, type ChangeView, type TreeNode,
} from './model'
import { DIFF_LINE_KEY, DIFF_LINE_POINT, PUSH_ACTIONS_MAX, PUSH_ACTIONS_POINT } from './extensionPoints'

const c = (path: string, staged: boolean, status: LocalChange['status'] = 'modified'): LocalChange => ({
  path,
  status,
  staged,
  additions: null,
  deletions: null,
})

describe('groupChanges', () => {
  it('splits staged/unstaged and sorts each by path', () => {
    const groups = groupChanges([c('z.ts', false), c('a.ts', true), c('m.ts', false), c('b.ts', true)])
    expect(groups.staged.map((x) => x.path)).toEqual(['a.ts', 'b.ts'])
    expect(groups.unstaged.map((x) => x.path)).toEqual(['m.ts', 'z.ts'])
  })

  it('sorts three groups, and a conflict is not a tracked edit', () => {
    const groups = groupChanges([
      c('n.md', false, 'untracked'),
      c('src/z.ts', true),
      c('src/clash.ts', false, 'conflicted'),
      c('src/a.ts', false),
    ])
    expect(groups.conflicted.map((r) => r.path)).toEqual(['src/clash.ts'])
    expect(groups.tracked.map((r) => r.path)).toEqual(['src/a.ts', 'src/z.ts'])
    expect(groups.untracked.map((r) => r.path)).toEqual(['n.md'])
  })

  // The state the row checkbox exists to draw: a file staged and then edited again is one row, half
  // in the index, and its diff is the working-tree half its checkbox names.
  it('puts a staged-and-edited file in Tracked once, partial', () => {
    const groups = groupChanges([c('src/both.ts', true), c('src/both.ts', false), c('src/only.ts', true)])
    expect(groups.tracked.map((r) => r.path)).toEqual(['src/both.ts', 'src/only.ts'])
    expect(groups.tracked[0]).toMatchObject({ path: 'src/both.ts', staged: false, partial: true })
    expect(groups.tracked[0].change.staged).toBe(false)
    expect(groups.tracked[1]).toMatchObject({ path: 'src/only.ts', staged: true, partial: false })
    expect(groups.tracked[1].change.staged).toBe(true)
  })
})

describe('the staging state a checkbox draws', () => {
  const rows = (changes: LocalChange[]) => stageableRows(groupChanges(changes))

  it('is all, some, or none over a group', () => {
    expect(stagedState(rows([c('a.ts', true), c('b.ts', true)]))).toBe('all')
    expect(stagedState(rows([c('a.ts', true), c('b.ts', false)]))).toBe('some')
    expect(stagedState(rows([c('a.ts', false), c('b.ts', false)]))).toBe('none')
    // A single half-staged file is 'some' on its own: there is something in the index.
    expect(stagedState(rows([c('a.ts', true), c('a.ts', false)]))).toBe('some')
    expect(stagedState([])).toBe('none')
  })

  it('leaves conflicts out of what a staging action reaches', () => {
    const groups = groupChanges([c('src/clash.ts', false, 'conflicted'), c('a.ts', false), c('n.md', false, 'untracked')])
    expect(stageableRows(groups).map((r) => r.path)).toEqual(['a.ts', 'n.md'])
  })

  it('sends only the paths that are not staged yet', () => {
    const groups = groupChanges([c('a.ts', true), c('b.ts', false), c('c.ts', true), c('c.ts', false)])
    expect(unstagedPathsOf(groups.tracked)).toEqual(['b.ts', 'c.ts'])
  })
})

describe('commitMode', () => {
  it('commits the index when anything is staged', () => {
    expect(commitMode(groupChanges([c('a.ts', true), c('b.ts', false)]))).toBe('staged')
  })

  it('commits tracked changes when nothing is staged', () => {
    expect(commitMode(groupChanges([c('a.ts', false), c('b.ts', false)]))).toBe('tracked')
  })

  it('has nothing to commit on a clean tree', () => {
    expect(commitMode(groupChanges([]))).toBe('none')
  })

  // `git commit -a` picks up tracked modifications and deletions. It walks past an untracked file,
  // and there is no half of a conflict it could take, so neither is something the button can offer.
  it('has nothing to commit in a tree of only conflicts, or only untracked files', () => {
    expect(commitMode(groupChanges([c('clash.ts', false, 'conflicted')]))).toBe('none')
    expect(commitMode(groupChanges([c('notes.md', false, 'untracked')]))).toBe('none')
  })

  // A file staged and then edited again is in the index, so the index is what a commit takes.
  it('commits the index for a file staged and then edited again', () => {
    expect(commitMode(groupChanges([c('a.ts', true), c('a.ts', false)]))).toBe('staged')
  })
})

describe('totals', () => {
  const counted = (path: string, additions: number | null, deletions: number | null): LocalChange => ({
    path, status: 'modified', staged: false, additions, deletions,
  })

  it('sums the rows on screen and skips the ones git could not count', () => {
    const groups = groupChanges([counted('a.ts', 3, 1), counted('b.ts', null, null), counted('c.ts', 10, 0)])
    expect(totals(groups.tracked)).toEqual({ additions: 13, deletions: 1 })
    expect(totals([])).toEqual({ additions: 0, deletions: 0 })
  })
})

describe('pickSelected', () => {
  const groups = groupChanges([c('a.ts', true), c('b.ts', false)])
  it('keeps a still-present selection, else falls back to the first unstaged change', () => {
    expect(pickSelected(groups, changeKey(c('a.ts', true)))?.path).toBe('a.ts')
    expect(pickSelected(groups, 'unstaged:gone.ts')?.path).toBe('b.ts')
    expect(pickSelected(groups, null)?.path).toBe('b.ts')
    expect(pickSelected(groupChanges([c('a.ts', true)]), null)?.path).toBe('a.ts')
    expect(pickSelected(groupChanges([]), null)).toBeNull()
  })
})

describe('stackFor', () => {
  it('stacks one staging area, so no path appears twice', () => {
    // src/both.ts is staged and then edited again, so it is in both groups.
    const groups = groupChanges([c('src/both.ts', true), c('src/both.ts', false), c('src/only-dirty.ts', false)])
    const staged = stackFor(groups, groups.staged[0])
    const unstaged = stackFor(groups, groups.unstaged[0])

    expect(staged.map((x) => x.path)).toEqual(['src/both.ts'])
    expect(unstaged.map((x) => x.path)).toEqual(['src/both.ts', 'src/only-dirty.ts'])
    for (const stack of [staged, unstaged]) {
      expect(new Set(stack.map((x) => x.path)).size).toBe(stack.length)
    }
    expect(stackFor(groups, null)).toEqual([])
  })
})

describe('toPullFile', () => {
  it('leaves a deleted file no new side, so its gaps stay inert', () => {
    expect(toPullFile(c('src/gone.ts', false, 'deleted'), '@@ -1 +0,0 @@\n-x').sha).toBeNull()
    expect(toPullFile(c('src/kept.ts', true), '').sha).toBe('staged')
  })

  it('hands the viewer a conflict as a modification, since that is the working copy it gets', () => {
    expect(toPullFile(c('src/clash.ts', false, 'conflicted'), '@@ -1 +1 @@\n-x\n+y').status).toBe('modified')
  })

  it('maps untracked → added and carries the patch', () => {
    expect(toPullFile(c('n.md', false, 'untracked'), '@@ -0,0 +1 @@\n+x')).toEqual({
      path: 'n.md',
      status: 'added',
      additions: null,
      deletions: null,
      sha: 'unstaged',
      viewed: false,
      patch: '@@ -0,0 +1 @@\n+x',
    })
  })
})

// The view menu's three choices, as pure functions over the rows phase 0 produces. Everything below
// is a table test because everything below is a table: the pane holds no state for any of it, and the
// only reactive thing in the tree view is which folders the reader has closed.

const view = (patch: Partial<ChangeView> = {}): ChangeView => ({ ...DEFAULT_CHANGE_VIEW, ...patch })
const rowsOf = (...changes: LocalChange[]) => {
  const groups = groupChanges(changes)
  return [...groups.tracked, ...groups.untracked]
}
/** A tree, flattened with every folder open, as `label` at `depth`. */
const drawn = (nodes: TreeNode[]) => visibleNodes(nodes, new Set()).map((node) => `${'  '.repeat(node.depth)}${node.label}`)

describe('buildTree', () => {
  it('collapses a single-child chain into one row and keeps a root file at the top level', () => {
    const tree = buildTree(rowsOf(c('a/b/c.ts', false), c('a/b/d.ts', false), c('e.ts', false)), view({ mode: 'tree' }))
    expect(drawn(tree)).toEqual(['a/b', '  c.ts', '  d.ts', 'e.ts'])
    expect(tree[0]).toMatchObject({ kind: 'folder', label: 'a/b', path: 'a/b', depth: 0 })
    expect(tree[0].children.map((node) => node.path)).toEqual(['a/b/c.ts', 'a/b/d.ts'])
  })

  it('stops collapsing where a folder has files of its own', () => {
    const tree = buildTree(rowsOf(c('a/keep.ts', false), c('a/b/c.ts', false)), view({ mode: 'tree' }))
    expect(drawn(tree)).toEqual(['a', '  b', '    c.ts', '  keep.ts'])
  })

  it('puts folders before files at every level', () => {
    const tree = buildTree(rowsOf(c('src/z/last.ts', false), c('src/a.ts', false)), view({ mode: 'tree' }))
    expect(drawn(tree)).toEqual(['src', '  z', '    last.ts', '  a.ts'])
  })

  it('keeps the rename a row carries, so the row still reads `old → new`', () => {
    const [row] = rowsOf({ path: 'src/new.ts', oldPath: 'src/old.ts', status: 'renamed', staged: true, additions: 1, deletions: 1 })
    const tree = buildTree([row], view({ mode: 'tree' }))
    expect(tree[0].children[0].row).toMatchObject({ path: 'src/new.ts', oldPath: 'src/old.ts' })
  })

  it('marks a folder key so the expand intent can tell one from a file row', () => {
    const tree = buildTree(rowsOf(c('a/b.ts', false)), view({ mode: 'tree' }))
    expect(isFolderKey(tree[0].key)).toBe(true)
    expect(isFolderKey(tree[0].children[0].key)).toBe(false)
  })
})

describe('visibleNodes', () => {
  it('leaves out everything under a closed folder, and keeps the folder itself', () => {
    const tree = buildTree(rowsOf(c('a/b/c.ts', false), c('e.ts', false)), view({ mode: 'tree' }))
    expect(visibleNodes(tree, new Set([tree[0].key])).map((node) => node.label)).toEqual(['a/b', 'e.ts'])
  })
})

describe('sortRows', () => {
  it('orders a flat list by basename across folders when the reader asks for a name sort', () => {
    const rows = rowsOf(c('src/zebra/a.ts', false), c('src/apple/z.ts', false), c('m.ts', false))
    expect(sortRows(rows, view({ sort: 'name' })).map((row) => row.path)).toEqual(['src/zebra/a.ts', 'm.ts', 'src/apple/z.ts'])
    expect(sortRows(rows, view({ sort: 'path' })).map((row) => row.path)).toEqual(['m.ts', 'src/apple/z.ts', 'src/zebra/a.ts'])
  })

  it('ignores the sort in tree view, where the folders are the order', () => {
    const rows = rowsOf(c('src/zebra/a.ts', false), c('src/apple/z.ts', false))
    expect(sortRows(rows, view({ mode: 'tree', sort: 'name' })).map((row) => row.path))
      .toEqual(['src/apple/z.ts', 'src/zebra/a.ts'])
  })
})

describe('folderState', () => {
  const folderIn = (changes: LocalChange[]): TreeNode => buildTree(rowsOf(...changes), view({ mode: 'tree' }))[0]

  it('is checked, unchecked, or indeterminate over what is under it', () => {
    expect(folderState(folderIn([c('a/one.ts', true), c('a/two.ts', true)]))).toBe('all')
    expect(folderState(folderIn([c('a/one.ts', true), c('a/two.ts', false)]))).toBe('some')
    expect(folderState(folderIn([c('a/one.ts', false), c('a/two.ts', false)]))).toBe('none')
  })

  it('is indeterminate for a folder holding a file staged and then edited again', () => {
    const folder = folderIn([c('a/both.ts', true), c('a/both.ts', false)])
    expect(folderState(folder)).toBe('some')
    // One row, not two, so the file's checkbox and its folder's say the same thing.
    expect(filesUnder(folder).map((row) => row.path)).toEqual(['a/both.ts'])
  })

  it('reads through a nested folder, because the checkbox stages the whole subtree', () => {
    const folder = folderIn([c('a/keep.ts', true), c('a/deep/one.ts', false)])
    expect(folderState(folder)).toBe('some')
    expect(unstagedPathsOf(filesUnder(folder))).toEqual(['a/deep/one.ts'])
  })
})

describe('groupSections', () => {
  const conflict = c('src/clash.ts', false, 'conflicted')
  const changes = [conflict, c('src/a.ts', true), c('src/b.ts', false), c('n.md', false, 'untracked')]
  const sectionsFor = (groupBy: ChangeView['groupBy']) =>
    groupSections(groupChanges(changes), view({ groupBy })).map((section) => [section.key, section.rows.map((row) => row.path)])

  it('draws the three default groups, conflicts first', () => {
    expect(sectionsFor('tracked')).toEqual([
      ['conflicted', ['src/clash.ts']],
      ['tracked', ['src/a.ts', 'src/b.ts']],
      ['untracked', ['n.md']],
    ])
  })

  it('splits by staging area, and a conflict is in neither', () => {
    expect(sectionsFor('staged')).toEqual([
      ['conflicted', ['src/clash.ts']],
      ['staged', ['src/a.ts']],
      ['unstaged', ['n.md', 'src/b.ts']],
    ])
  })

  it('leaves one run with no fold when the reader asks for no groups', () => {
    expect(sectionsFor('none')).toEqual([
      ['conflicted', ['src/clash.ts']],
      ['all', ['n.md', 'src/a.ts', 'src/b.ts']],
    ])
    expect(groupSections(groupChanges(changes), view({ groupBy: 'none' }))[1].title).toBeNull()
  })

  it('leaves an empty group out, and answers nothing at all for a clean tree', () => {
    expect(groupSections(groupChanges([c('a.ts', false)]), view()).map((s) => s.key)).toEqual(['tracked'])
    expect(groupSections(groupChanges([]), view())).toEqual([])
  })
})

describe('viewNodes', () => {
  it('is the rows themselves in list view, in the order the section holds them', () => {
    const rows = rowsOf(c('src/a.ts', false), c('b.ts', false))
    expect(viewNodes(rows, view()).map((node) => [node.kind, node.label, node.depth]))
      .toEqual([['file', 'b.ts', 0], ['file', 'a.ts', 0]])
  })
})

// The annotation point this pane opens on its diff lines (docs/plugins.md § Cooperative extension
// points). The fields have to be the ones the shared viewer mints per row, in that order, or a
// contributor's marks look up under a string nothing ever wrote and draw nothing — silently, because
// an unmatched contribution is silent by design.
//
// Written out rather than compared against `DIFF_ANNOTATION_FIELDS`: that constant lives beside the
// viewer in client-core, and importing across the plugin boundary to check a three-string list would be
// the coupling this seam exists to avoid. The pairing is held from the other end too, in client-core's
// annotationKey.test.ts.
describe('the diff-line annotation point', () => {
  it('is keyed by the three fields the viewer mints, in the viewer\'s order', () => {
    expect(DIFF_LINE_KEY).toEqual(['file', 'line', 'side'])
  })

  it('is addressed under this plugin\'s own name, which the host mints', () => {
    expect(DIFF_LINE_POINT).toBe('changes:diff-line')
  })
})

// The room under the branch bar, held here for the same reason: a contributor in another plugin spells
// this string by hand, because a plugin may not import another plugin, so a rename here is a silent
// empty slot over there.
describe('the push-actions point', () => {
  it('is addressed under this plugin\'s own name, which the host mints', () => {
    expect(PUSH_ACTIONS_POINT).toBe('changes:push-actions')
  })

  // Two, because a third contributor would be a toolbar in somebody else's footer. The ceiling is the
  // owner's because the footer is.
  it('holds a couple of contributors, not a strip', () => {
    expect(PUSH_ACTIONS_MAX).toBe(2)
  })
})

// Where the branch stands, as the bar reads it. `null` and `0` are different answers: a branch with
// no upstream has nothing to count against, and a branch level with its upstream has counted.
const at = (upstream: string | null, ahead: number | null, behind: number | null) => ({ upstream, ahead, behind })

describe('primaryRemote', () => {
  it('offers Publish to a branch with no upstream', () => {
    expect(primaryRemote(at(null, null, null))).toBe('publish')
  })

  it('offers Pull when the upstream is ahead of this branch', () => {
    expect(primaryRemote(at('origin/main', 0, 3))).toBe('pull')
  })

  it('offers Push when this branch is ahead', () => {
    expect(primaryRemote(at('origin/main', 2, 0))).toBe('push')
  })

  // Behind wins, because a push from behind fails and a pull from ahead does not: the button offered
  // is the one that can work.
  it('offers Pull on a diverged branch, not Push', () => {
    expect(primaryRemote(at('origin/main', 2, 3))).toBe('pull')
  })

  it('offers Fetch when the two are level, because nothing else can change the answer', () => {
    expect(primaryRemote(at('origin/main', 0, 0))).toBe('fetch')
  })
})

describe('remoteCounts', () => {
  it('says so when there is no upstream to count against', () => {
    expect(remoteCounts(at(null, null, null))).toBe('no upstream')
  })

  it('draws behind before ahead, which is the order the arrows read in', () => {
    expect(remoteCounts(at('origin/main', 144, 2))).toBe('↓2 ↑144')
    expect(remoteCounts(at('origin/main', 1, 0))).toBe('↑1')
    expect(remoteCounts(at('origin/main', 0, 5))).toBe('↓5')
  })

  // Nothing to report is better said by saying nothing than by two zeros.
  it('says nothing at all about a branch level with its upstream', () => {
    expect(remoteCounts(at('origin/main', 0, 0))).toBe('')
  })
})

describe('remoteReason', () => {
  it('sends a refused fast-forward to the rebase in the menu', () => {
    const said = remoteReason('pull', 'fatal: Not possible to fast-forward, aborting.')
    expect(said).toContain('Not possible to fast-forward')
    expect(said).toContain('Pull with rebase')
  })

  // What a push after an amend hits: the branch is ahead of an upstream still holding the old commit.
  it('sends a rejected push to Force push, and names the lease', () => {
    const said = remoteReason('push', 'Updates were rejected because the tip of your current branch is behind')
    expect(said).toContain('Force push')
    expect(said).toContain('lease')
  })

  // The lease refusing is not a case for pressing harder: somebody else pushed.
  it('sends a failed lease to a fetch rather than to another force', () => {
    const said = remoteReason('force', 'stale info: remote ref is at a commit you do not have')
    expect(said).toContain('Fetch first')
    expect(said).not.toContain('Force push')
  })

  it('passes a reason it does not recognise through untouched', () => {
    expect(remoteReason('fetch', 'ssh: Could not resolve hostname')).toBe('ssh: Could not resolve hostname')
    expect(remoteReason('pull', 'ssh: Could not resolve hostname')).toBe('ssh: Could not resolve hostname')
  })
})

describe('generateReason', () => {
  // Matched on the envelope\'s `code`, because `ApiError` is not on the plugin surface.
  it('turns the two provider codes into a next step', () => {
    expect(generateReason({ code: 'provider_needs_auth', message: 'provider_needs_auth' })).toContain('Reconnect it in Settings')
    expect(generateReason({ code: 'provider_rate_limited', message: 'x' })).toContain('rate-limiting')
    expect(generateReason({ code: 'provider_unavailable', message: 'x' })).toContain('did not answer')
  })

  // An installed CLI that is signed out fails the same way an unreachable provider does, and
  // "try again shortly" is the wrong advice: nothing changes until somebody runs it in a terminal.
  it('sends a harness to a terminal instead of telling it to try again', () => {
    const unavailable = { code: 'provider_unavailable', message: 'x' }
    expect(generateReason(unavailable, { kind: 'harness', label: 'Claude Code' }))
      .toBe('Claude Code did not answer. Run it once in a terminal to check it is signed in.')
    expect(generateReason(unavailable, { kind: 'connection', label: 'Anthropic' }))
      .toBe('The provider did not answer. Try again shortly.')
  })

  it('keeps the node\'s own prose for a refusal it wrote itself', () => {
    const error = Object.assign(new Error('Nothing staged or changed to describe.'), { code: 'nothing_to_commit' })
    expect(generateReason(error)).toBe('Nothing staged or changed to describe.')
  })

  it('has something to say about a throw that is not an error at all', () => {
    expect(generateReason(null)).toBe('Writing the message failed.')
    expect(generateReason(new Error(''))).toBe('Writing the message failed.')
  })
})
