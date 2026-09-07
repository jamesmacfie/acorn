// ChangesPane model: pure grouping, ordering and selection over LocalChange[], plus the adapter
// that feeds a local patch into the shared diff pipeline (DiffFile shape, diff.ts).
import type { DiffFile } from '@acorn/plugin-api/ui/diff'
import { defaultModelIdFor, type AvailableModelConnection } from '@acorn/protocol/modelProviders.ts'
import type { LocalChange, LocalStatus } from '@acorn/protocol/terminal.ts'
import type { ModelPick } from '../shared/api'

/** The three groups the list draws, top to bottom. Conflicts, tracked edits and untracked files are
 *  three different situations for the reader, and only the middle one is a staging question. */
export type ChangeGroup = 'conflicted' | 'tracked' | 'untracked'

/** One file as the list draws it: one row per path, whichever of its two halves git reported.
 *
 *  `staged` means every change to the file is in the index and `partial` means only some of it is —
 *  a file staged and then edited again. Those two are the row checkbox's checked and indeterminate
 *  states, and `change` is the half whose diff the column shows, which is the half the checkbox
 *  names: indeterminate reads as "not staged", so the working-tree side is what appears. */
export type FileRow = {
  key: string
  group: ChangeGroup
  path: string
  oldPath?: string
  status: LocalChange['status']
  staged: boolean
  partial: boolean
  additions: number | null
  deletions: number | null
  change: LocalChange
}

export type ChangesGroups = {
  conflicted: FileRow[]
  tracked: FileRow[]
  untracked: FileRow[]
  /** The two staging areas, unrolled, because the diff column still stacks one at a time (stackFor). */
  staged: LocalChange[]
  unstaged: LocalChange[]
}

const byPath = (a: LocalChange, b: LocalChange) => a.path.localeCompare(b.path)

const groupOf = (change: LocalChange): ChangeGroup =>
  change.status === 'conflicted' ? 'conflicted' : change.status === 'untracked' ? 'untracked' : 'tracked'

// The row for one path, from whichever halves git reported for it. The counts come from the half on
// screen rather than from a sum of the two: they describe the diff the reader is about to open, and
// HEAD-to-index plus index-to-worktree added together describes neither.
const rowFor = (group: ChangeGroup, staged: LocalChange | undefined, unstaged: LocalChange | undefined): FileRow => {
  const change = unstaged ?? staged!
  return {
    key: changeKey(change),
    group,
    path: change.path,
    oldPath: change.oldPath,
    status: change.status,
    staged: !unstaged,
    partial: !!staged && !!unstaged,
    additions: change.additions,
    deletions: change.deletions,
    change,
  }
}

export function groupChanges(changes: LocalChange[]): ChangesGroups {
  // Keyed by group and path so a file staged and then edited again is one row with an indeterminate
  // checkbox, rather than the same name in two places with no way to tell which is which.
  const halves = new Map<string, { group: ChangeGroup; staged?: LocalChange; unstaged?: LocalChange }>()
  for (const change of [...changes].sort(byPath)) {
    const group = groupOf(change)
    const key = `${group}:${change.path}`
    const held = halves.get(key) ?? { group }
    held[change.staged ? 'staged' : 'unstaged'] = change
    halves.set(key, held)
  }
  const rows = [...halves.values()].map((held) => rowFor(held.group, held.staged, held.unstaged))
  return {
    conflicted: rows.filter((row) => row.group === 'conflicted'),
    tracked: rows.filter((row) => row.group === 'tracked'),
    untracked: rows.filter((row) => row.group === 'untracked'),
    staged: changes.filter((c) => c.staged).sort(byPath),
    unstaged: changes.filter((c) => !c.staged).sort(byPath),
  }
}

/** The rows a group's checkbox and the header's Stage all act on: everything but the conflicts, which
 *  are resolved one at a time and never unstaged. */
export const stageableRows = (groups: ChangesGroups): FileRow[] => [...groups.tracked, ...groups.untracked]

/** The paths a group's checkbox sends. Checked means "stage what is not staged", and unchecking a
 *  fully staged group unstages all of it. */
export const unstagedPathsOf = (rows: readonly FileRow[]): string[] => rows.filter((row) => !row.staged).map((row) => row.path)

/** Tri-state for a group's or the header's checkbox: every row staged, some of them, or none. */
export function stagedState(rows: readonly FileRow[]): 'all' | 'some' | 'none' {
  if (!rows.length) return 'none'
  if (rows.every((row) => row.staged)) return 'all'
  return rows.some((row) => row.staged || row.partial) ? 'some' : 'none'
}

/** The header's `+N −M`, summed over the rows on screen. A row with no counts — a conflict, an
 *  untracked file, a binary — contributes nothing rather than a zero, so the sum stays a fact about
 *  the files git could count. */
export function totals(rows: readonly FileRow[]): { additions: number; deletions: number } {
  return rows.reduce(
    (sum, row) => ({ additions: sum.additions + (row.additions ?? 0), deletions: sum.deletions + (row.deletions ?? 0) }),
    { additions: 0, deletions: 0 },
  )
}

/** What the commit button does, and what it says.
 *
 *  `staged` commits the index. `tracked` is Zed's rule and removes the most common extra click:
 *  with nothing staged, the button reads Commit tracked and the client asks for `git commit -a`,
 *  which takes every tracked modification and deletion and leaves untracked files where they are.
 *  `none` is a tree with nothing a commit could pick up, so the button is disabled: a clean tree, and
 *  also a tree holding nothing but conflicts or nothing but untracked files. */
export type CommitMode = 'staged' | 'tracked' | 'none'

export function commitMode(groups: ChangesGroups): CommitMode {
  if (groups.staged.length) return 'staged'
  return groups.tracked.length ? 'tracked' : 'none'
}

/** What the bar's primary button offers. Four labels over three git commands: Publish and Push are
 *  both `git push --set-upstream origin HEAD`, and the label is the only difference. */
export type RemoteVerb = 'publish' | 'pull' | 'push' | 'fetch'

/** Every verb the bar can actually run, which is one more than the button offers: the menu holds the
 *  rebase form of a pull and the leased form of a push, and the banner holds the abort. */
export type RemoteAction = 'fetch' | 'pull' | 'rebase' | 'push' | 'force' | 'abort'

/** Where the branch stands against its upstream. Only the three fields that decide it, so a caller
 *  can ask about a hypothetical without building a whole status record. */
export type RemoteState = Pick<LocalStatus, 'upstream' | 'ahead' | 'behind'>

/** The one thing to do next.
 *
 *  Behind wins over ahead because a push from behind fails and a pull from ahead does not, so on a
 *  diverged branch the button that works is the one offered. In sync it is Fetch, which is the only
 *  verb that can change the answer. */
export function primaryRemote(state: RemoteState): RemoteVerb {
  if (state.upstream == null) return 'publish'
  if ((state.behind ?? 0) > 0) return 'pull'
  if ((state.ahead ?? 0) > 0) return 'push'
  return 'fetch'
}

/** The counts beside the button, as text. Facts rather than a control: Zed puts them inside the
 *  button, and keeping them out means the button's label is only the verb, which is what a 40-cell
 *  row in a terminal has room for.
 *
 *  Empty when the branch is level with its upstream. Nothing to report is better said by saying
 *  nothing than by two zeros. */
export function remoteCounts(state: RemoteState): string {
  if (state.upstream == null) return 'no upstream'
  const parts: string[] = []
  if (state.behind) parts.push(`↓${state.behind}`)
  if (state.ahead) parts.push(`↑${state.ahead}`)
  return parts.join(' ')
}

/** git's refusal, plus the next thing to press.
 *
 *  git says what went wrong and acorn is the only one that knows which control fixes it, so the
 *  sentence is assembled here rather than on the node: a node that named a menu would be writing UI
 *  copy for two hosts it cannot see. Pure and matched on git's own wording, which is stable enough
 *  to hint on and not to depend on — an unrecognised reason is passed through unchanged. */
export function remoteReason(action: RemoteAction, reason: string): string {
  const said = (pattern: RegExp) => pattern.test(reason)
  if (action === 'pull' && said(/fast-forward|diverged/i)) {
    return `${reason} Use Pull with rebase from the menu.`
  }
  // What a push after an amend hits: the branch is ahead of an upstream that still holds the old
  // commit, so git calls it non-fast-forward. Force push is the deliberate next step, and its lease
  // is what makes it safe to name here.
  if (action === 'push' && said(/non-fast-forward|rejected|fetch first/i)) {
    return `${reason} Force push from the menu replaces it, with a lease that refuses to drop a commit this node has not fetched.`
  }
  // The lease itself refusing. Not a case for pressing harder: somebody else pushed, and the fix is
  // to look at what they pushed.
  if (action === 'force' && said(/stale info|rejected|lease/i)) {
    return `${reason} Fetch first: the remote has moved since this node last looked.`
  }
  return reason
}

/** Which connection and model the wand will spend, given what is connected and what was remembered.
 *
 *  The remembered pick wins while it still resolves, so a reader who chose Anthropic keeps it. A pick
 *  whose connection has gone falls back to the first connection rather than failing, because a
 *  disconnected provider in a device preference is a stale note, not a decision to honour. Its
 *  provider's own default model is the fallback, which is what `ModelConnectionPicker` opens on, so
 *  the picker and the silent path start on the same model by construction.
 *
 *  `null` when nothing is connected, which is what hides the wand. */
export function effectiveModelPick(
  connections: readonly AvailableModelConnection[],
  remembered: ModelPick | null,
): ModelPick | null {
  const held = remembered ? connections.find((candidate) => candidate.connection.id === remembered.connectionId) : undefined
  if (remembered && held) {
    // The model is checked against the provider's list too: a provider that dropped a model between
    // releases would otherwise be asked for one it no longer serves.
    const known = held.provider.models?.some((model) => model.id === remembered.modelId)
    return { connectionId: remembered.connectionId, modelId: known ? remembered.modelId : defaultModelIdFor(held) }
  }
  const first = connections[0]
  return first ? { connectionId: first.connection.id, modelId: defaultModelIdFor(first) } : null
}

/** What a failed generate says in the footer's alert.
 *
 *  Matched on the error envelope's `code` rather than on an `ApiError` instance: the class is not on
 *  the plugin surface, and the code is the part of the envelope that is a contract
 *  (docs/api-reference.md § Errors). Two provider codes get a next step; everything else keeps
 *  the node's own prose, which for a refusal is the sentence the bridge wrote. */
export function generateReason(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? String((error as { code: unknown }).code) : ''
  if (code === 'provider_needs_auth') return 'The provider key was rejected. Reconnect it in Settings, under Integrations.'
  if (code === 'provider_rate_limited') return 'The provider is rate-limiting requests. Try again shortly.'
  if (code === 'provider_unavailable') return 'The provider did not answer. Try again shortly.'
  return error instanceof Error && error.message ? error.message : 'Writing the message failed.'
}

/** How the list is drawn, remembered per device (./changesPrefs.ts). Three choices that do not
 *  interact: the shape, the order inside a flat list, and what the rows are grouped by. */
export type ChangeView = {
  mode: 'list' | 'tree'
  sort: 'path' | 'name'
  groupBy: 'none' | 'tracked' | 'staged'
}

/** What the pane drew before it had a menu: a flat run in path order, in three groups. */
export const DEFAULT_CHANGE_VIEW: ChangeView = { mode: 'list', sort: 'path', groupBy: 'tracked' }

const baseName = (path: string) => path.slice(path.lastIndexOf('/') + 1)

/** A section's rows, in order. By path everywhere except a name-sorted flat list: a tree is ordered
 *  by its folders, and inside one folder the two orders are the same order. */
export function sortRows(rows: readonly FileRow[], view: ChangeView): FileRow[] {
  const byName = view.mode === 'list' && view.sort === 'name'
  return [...rows].sort((a, b) => (byName
    ? baseName(a.path).localeCompare(baseName(b.path)) || a.path.localeCompare(b.path)
    : a.path.localeCompare(b.path)))
}

/** One run of rows with its fold. `title` is null for the section that has no fold: grouping by
 *  nothing leaves a single run, and the control over all of it is already the header's Stage all. */
export type ChangeSection = { key: string; title: string | null; rows: FileRow[] }

/** The sections the list draws, top to bottom, empty ones left out.
 *
 *  Conflicts keep their own section in all three groupings. Nothing else in the panel is the next
 *  move while one is open, and a conflicted row has no checkbox for another grouping to gather, so
 *  the Staged and Unstaged pair below is over the rest. */
export function groupSections(groups: ChangesGroups, view: ChangeView): ChangeSection[] {
  const sections: ChangeSection[] = []
  const add = (key: string, title: string | null, rows: readonly FileRow[]) => {
    if (rows.length) sections.push({ key, title, rows: sortRows(rows, view) })
  }
  add('conflicted', 'Conflicts', groups.conflicted)
  const rest = [...groups.tracked, ...groups.untracked]
  if (view.groupBy === 'tracked') {
    add('tracked', 'Tracked', groups.tracked)
    add('untracked', 'Untracked', groups.untracked)
  } else if (view.groupBy === 'staged') {
    // A file staged and then edited again is not staged, so it sits under Unstaged with the
    // indeterminate checkbox it has everywhere else.
    add('staged', 'Staged', rest.filter((row) => row.staged))
    add('unstaged', 'Unstaged', rest.filter((row) => !row.staged))
  } else {
    add('all', null, rest)
  }
  return sections
}

/** A folder row's key, and the tell that a key belongs to a folder: `Rows` hands its expand intent a
 *  key and nothing else, so the answer to "did this row fold" has to come from the key alone. The
 *  same trick `changeKey` plays with its two staging areas. */
const FOLDER_KEY = 'dir:'
export const isFolderKey = (key: string): boolean => key.startsWith(FOLDER_KEY)

/** One row of the tree. A folder's `label` is the whole collapsed chain (`apps/tui/src`) and its
 *  `path` is the deepest folder in it, which is what its checkbox stages. */
export type TreeNode = {
  key: string
  kind: 'folder' | 'file'
  label: string
  path: string
  depth: number
  children: TreeNode[]
  row?: FileRow
}

type Bucket = { folders: Map<string, Bucket>; files: FileRow[] }

const fileNode = (row: FileRow, depth: number): TreeNode =>
  ({ key: row.key, kind: 'file', label: baseName(row.path), path: row.path, depth, children: [], row })

// Folders before files at every level: a folder is where a reader looks to find a file, and a run of
// files between two folders hides one.
const nodesIn = (bucket: Bucket, prefix: string, depth: number, view: ChangeView): TreeNode[] => [
  ...[...bucket.folders.entries()]
    .sort(([one], [other]) => one.localeCompare(other))
    .map(([name, child]) => folderNode(name, child, prefix, depth, view)),
  ...sortRows(bucket.files, view).map((row) => fileNode(row, depth)),
]

const folderNode = (name: string, bucket: Bucket, prefix: string, depth: number, view: ChangeView): TreeNode => {
  // A folder holding nothing but one folder joins it, so four levels of `apps/tui/src/kit` are one
  // row rather than four with a single child each.
  let label = name
  let held = bucket
  while (held.files.length === 0 && held.folders.size === 1) {
    const [childName, child] = [...held.folders.entries()][0]
    label = `${label}/${childName}`
    held = child
  }
  const path = prefix ? `${prefix}/${label}` : label
  return {
    key: `${FOLDER_KEY}${path}`,
    kind: 'folder',
    label,
    path,
    depth,
    children: nodesIn(held, path, depth + 1, view),
  }
}

/** Paths to a folder tree, single-child chains collapsed. A function rather than a component, so the
 *  list maps it to rows and every case here is a table test. */
export function buildTree(rows: readonly FileRow[], view: ChangeView): TreeNode[] {
  const root: Bucket = { folders: new Map(), files: [] }
  for (const row of rows) {
    let bucket = root
    for (const part of row.path.split('/').slice(0, -1)) {
      const held = bucket.folders.get(part) ?? { folders: new Map(), files: [] }
      bucket.folders.set(part, held)
      bucket = held
    }
    bucket.files.push(row)
  }
  return nodesIn(root, '', 0, view)
}

/** The nodes one section draws: a flat run in list view, a folder tree in tree view. Both shapes are
 *  the same node, so the list has one row body rather than two. */
export const viewNodes = (rows: readonly FileRow[], view: ChangeView): TreeNode[] =>
  view.mode === 'tree' ? buildTree(rows, view) : rows.map((row) => fileNode(row, 0))

/** Every file under a node, in tree order: what a folder's checkbox acts on. */
export const filesUnder = (node: TreeNode): FileRow[] =>
  node.row ? [node.row] : node.children.flatMap(filesUnder)

/** Tri-state for a folder's checkbox. Derived, never stored: the status resource is the truth, and a
 *  file staged and then edited again leaves its folders indeterminate. */
export const folderState = (node: TreeNode): 'all' | 'some' | 'none' => stagedState(filesUnder(node))

/** The nodes on screen, parents before children, with everything under a closed folder left out.
 *
 *  Closed rather than open is what is remembered, because a tree that opened closed would show a
 *  reader with eighty changed files under `apps/` a single row. */
export function visibleNodes(nodes: readonly TreeNode[], closed: ReadonlySet<string>): TreeNode[] {
  const out: TreeNode[] = []
  const walk = (list: readonly TreeNode[]) => {
    for (const node of list) {
      out.push(node)
      if (node.kind === 'folder' && !closed.has(node.key)) walk(node.children)
    }
  }
  walk(nodes)
  return out
}

// Stable row identity: a file can appear in both groups.
export const changeKey = (c: Pick<LocalChange, 'staged' | 'path'>): string => `${c.staged ? 'staged' : 'unstaged'}:${c.path}`

// The stack the diff column shows: every change in the selected row's staging area, in list order.
//
// One area at a time, not both concatenated. A file staged and then edited again appears in both
// groups, and the row model keys a file by its path alone, so a combined stack would hold two files
// claiming the same identity and the second would win. Which area is on screen is visible: it is the
// group the highlighted row sits in.
export function stackFor(groups: ChangesGroups, selected: LocalChange | null): LocalChange[] {
  if (!selected) return []
  return selected.staged ? groups.staged : groups.unstaged
}

// Keep the current selection while it still exists, else fall back to the first unstaged change.
//
// Unstaged first, even though the staged group renders above it, because this also picks which
// staging area the diff column stacks. Staging is deliberate and usually the last thing before a
// commit, so one staged file should not hide twenty unstaged ones from a reader who has not clicked
// anything yet. It falls through to staged when the working tree is clean.
export function pickSelected(groups: ChangesGroups, selectedKey: string | null): LocalChange | null {
  const all = [...groups.staged, ...groups.unstaged]
  if (selectedKey) {
    const kept = all.find((c) => changeKey(c) === selectedKey)
    if (kept) return kept
  }
  return groups.unstaged[0] ?? groups.staged[0] ?? null
}

// Local change + patch → the DiffFile shape the diff model consumes.
//
// `sha` carries the staging area rather than a blob hash. The viewer never reads it; it hands it
// straight back through DiffSource.fileText, which is how a gap gets filled, and for a working tree
// "which side" is the staging area (the index for staged, the file on disk for unstaged). It stays
// null for a deletion, which is how the viewer knows to draw that file's gaps inert: there is no new
// side of a file that is gone.
export function toPullFile(change: LocalChange, patch: string | null): DiffFile {
  return {
    path: change.path,
    // The viewer's vocabulary has no conflict: what it is being handed is the working copy with the
    // markers in it, which is a modification.
    status: change.status === 'untracked' ? 'added' : change.status === 'conflicted' ? 'modified' : change.status,
    additions: change.additions,
    deletions: change.deletions,
    sha: change.status === 'deleted' ? null : change.staged ? 'staged' : 'unstaged',
    viewed: false,
    patch,
  }
}
