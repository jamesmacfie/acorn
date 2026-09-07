// The prompt behind the commit editor's wand: which diff describes the commit about to happen, how
// much of it fits, and what the model is asked to write.
//
// Every function here is pure over a status read and a patch, so the budget rule and the wording are
// a table test rather than something only a live provider can show. The git calls and the
// `core.models` call are next door in ./localGit.ts, and the route that spends a key is in
// ./routes/localGit.ts.
import type { LocalChange } from '@acorn/protocol/terminal.ts'
import { COMMIT_MESSAGE_MAX_PROMPT_CHARS } from '../shared/api'

/** Which diff a generated message should describe.
 *
 *  The same rule the commit button follows (../client/model.ts § commitMode): with something in the
 *  index the commit is the index, and with nothing in it the commit is every tracked change. Derived
 *  from the node's own status read rather than taken from the request, because the panel's copy is up
 *  to one poll old and the message has to describe what the next commit will actually contain.
 *
 *  `null` is a tree with nothing a commit could pick up, which is a refusal before any provider call:
 *  untracked files alone are not what `git commit -a` takes, and a conflict is not a description job. */
export type CommitDiffScope = 'staged' | 'tracked'

const isTracked = (change: LocalChange): boolean => change.status !== 'untracked' && change.status !== 'conflicted'

export function commitDiffScope(changes: readonly LocalChange[]): CommitDiffScope | null {
  if (changes.some((change) => change.staged)) return 'staged'
  return changes.some((change) => !change.staged && isTracked(change)) ? 'tracked' : null
}

/** One file as the prompt names it: the path, and how much of it moved. */
export type CommitFile = { path: string; additions: number | null; deletions: number | null }

/** The files in the chosen diff, one row per path, ordered smallest first.
 *
 *  A file staged and then edited again appears twice in the status read, once per staging area; the
 *  path is what git is asked about, so the duplicate collapses here. Counts come from the half in the
 *  chosen scope. */
export function commitFiles(changes: readonly LocalChange[], scope: CommitDiffScope): CommitFile[] {
  const wanted = changes.filter((change) => (scope === 'staged' ? change.staged : !change.staged && isTracked(change)))
  const byPath = new Map<string, CommitFile>()
  for (const change of wanted) {
    byPath.set(change.path, { path: change.path, additions: change.additions, deletions: change.deletions })
  }
  return [...byPath.values()].sort((a, b) => sizeOf(a) - sizeOf(b) || a.path.localeCompare(b.path))
}

/** How many lines a file moved, for the ordering and the estimate. A file git could not count — a
 *  binary, a rename with no content change — sorts last rather than first, because "no numstat" is
 *  not "no bytes". */
const sizeOf = (file: CommitFile): number =>
  file.additions == null && file.deletions == null ? Number.MAX_SAFE_INTEGER : (file.additions ?? 0) + (file.deletions ?? 0)

/** Roughly how many characters a file's patch will take: its lines, plus git's per-file header.
 *
 *  An estimate rather than a measurement, because it decides which paths `git diff` is asked for and
 *  the measurement only exists afterwards. Sixty characters a line is generous for source and short
 *  for minified output; the real budget is applied to the real text in `buildCommitPrompt`. */
const CHARS_PER_LINE = 60
const PATCH_HEADER_CHARS = 160
const estimate = (file: CommitFile): number => PATCH_HEADER_CHARS + Math.min(sizeOf(file), 100_000) * CHARS_PER_LINE

/** Which files' patches to ask git for, and which to name without one.
 *
 *  Smallest first until the budget's estimate is spent. Smallest first rather than largest, because a
 *  message is a summary and ten small files say more about the shape of a change than half of one
 *  large one. The first file is always included, so a single enormous file still gets its patch read
 *  and trimmed rather than being described by its name alone.
 *
 *  Everything left over is still listed, with its counts, so the model knows those files moved and
 *  can say so.
 *
 *  This is also what bounds the argv of the one `git diff` call: the cheapest a file can be is its
 *  header, so a 12,000-character budget can never name more than 75 paths. */
export function splitByBudget(
  files: readonly CommitFile[],
  budget = COMMIT_MESSAGE_MAX_PROMPT_CHARS,
): { include: CommitFile[]; omit: CommitFile[] } {
  const include: CommitFile[] = []
  const omit: CommitFile[] = []
  let spent = 0
  for (const file of files) {
    const cost = estimate(file)
    if (include.length && spent + cost > budget) omit.push(file)
    else {
      include.push(file)
      spent += cost
    }
  }
  return { include, omit }
}

/** One `git diff` back apart into per-file patches, keyed by the path git named on the `b/` side.
 *
 *  One git call rather than one per file: the paths are already bounded by `splitByBudget`, and a
 *  process per file over a hundred small files is a hundred spawns to build one prompt.
 *
 *  The `b/` side is the key because that is the name the file has after the commit, which is the name
 *  the reader will look for. A deletion has `b/dev/null` and keeps its `a/` name instead. */
export function splitPatch(diff: string): Map<string, string> {
  const out = new Map<string, string>()
  // `diff --git a/<old> b/<new>` at the start of a line. The `a/` half is matched greedily, so the
  // split falls on the last ` b/` in the header, which is the right one for every path git writes
  // unquoted. A path containing the literal ` b/` would split wrong; git quotes the odd ones, and a
  // path this misses simply gets no patch rather than the wrong file's.
  const parts = diff.split(/^diff --git /m).slice(1)
  for (const part of parts) {
    const header = part.slice(0, part.indexOf('\n') === -1 ? part.length : part.indexOf('\n'))
    const path = pathFromHeader(header)
    if (path) out.set(path, `diff --git ${part}`.trimEnd())
  }
  return out
}

const pathFromHeader = (header: string): string | null => {
  const both = /^a\/(.+) b\/(.+)$/.exec(header.trim())
  if (!both) return null
  const [, from, to] = both
  return to === 'dev/null' ? from! : to!
}

/** What the model is told it is doing. Held apart from the diff so the two halves are separately
 *  readable, which is how `core.models.generateText` takes them. */
export const COMMIT_MESSAGE_SYSTEM = [
  'You write git commit messages. You are given a branch name and the diff that is about to be committed.',
  'Answer with the commit message and nothing else: no code fence, no quotation marks, no preamble.',
  'The first line is the subject: imperative mood, under 72 characters, no trailing period.',
  'Use a conventional prefix (feat, fix, refactor, docs, test, chore) when the diff clearly is one.',
  'Then, only if the change needs it, a blank line and a short body saying why rather than what.',
  'Describe what the diff does. Do not invent a ticket number, an author, or a change you cannot see.',
].join('\n')

/** The prompt: the branch, what is being committed, the file list, and as much patch as fits.
 *
 *  The branch is in it because a branch name is usually the one sentence of intent anybody wrote
 *  down, and it is the difference between "update the parser" and "fix the crash on an empty header".
 *
 *  The trim is on the real text rather than the estimate: a file whose patch turns out longer than
 *  its line count suggested is cut mid-patch with a line saying so, which is better than dropping it
 *  silently or blowing the budget. */
export function buildCommitPrompt(args: {
  branch: string | null
  scope: CommitDiffScope
  include: readonly CommitFile[]
  omit: readonly CommitFile[]
  patches: ReadonlyMap<string, string>
  budget?: number
}): string {
  const budget = args.budget ?? COMMIT_MESSAGE_MAX_PROMPT_CHARS
  const lines: string[] = [
    `Branch: ${args.branch ?? 'detached HEAD'}`,
    args.scope === 'staged'
      ? 'Committing what is in the index.'
      : 'Nothing is staged, so committing every tracked change.',
    '',
    'Files:',
    ...[...args.include, ...args.omit].map(fileLine),
  ]
  let spent = 0
  for (const file of args.include) {
    const patch = args.patches.get(file.path)
    if (!patch) continue
    const room = budget - spent
    if (room <= 0) break
    lines.push('', patch.length > room ? `${patch.slice(0, room)}\n… patch truncated` : patch)
    spent += Math.min(patch.length, room)
  }
  if (args.omit.length) {
    lines.push('', `The last ${args.omit.length} file${args.omit.length === 1 ? '' : 's'} above changed too; their patches did not fit.`)
  }
  return lines.join('\n')
}

const fileLine = (file: CommitFile): string =>
  file.additions == null && file.deletions == null
    ? `- ${file.path}`
    : `- ${file.path} +${file.additions ?? 0} -${file.deletions ?? 0}`

/** What comes back, made safe to drop in the field.
 *
 *  Models wrap an answer in a fence or in quotation marks however firmly the system prompt says not
 *  to, and a commit message beginning with three backticks is a commit message somebody has to edit.
 *  The same reason `stripSqlFences` exists in the database plugin. */
export function cleanCommitMessage(text: string): string {
  let out = text.trim()
  const fenced = /^```[a-z]*\n([\s\S]*?)\n?```$/.exec(out)
  if (fenced) out = fenced[1]!.trim()
  // Only when both ends are quoted and nothing inside is, so a subject that legitimately quotes a
  // flag keeps its quotes.
  if (/^"[^"]*"$/.test(out)) out = out.slice(1, -1).trim()
  return out
}
