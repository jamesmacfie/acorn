// Who last changed a line, as one `editor:line` mark per key (docs/editor/line-annotations.md).
//
// Editor asks about the cursor line of a saved file, keyed by the SHA-256 of the body it shows. Git
// answers only when the file on disk has that hash before and after blame runs, so a mark never
// describes text the reader isn't looking at.
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolveInRoot, type CoreServices } from '@acorn/plugin-api/node'
import type { PluginAnnotationMark } from '@acorn/protocol/extensionPoints.ts'
import type { EditorLineAnnotationKey } from '@acorn/plugin-editor/contract/lineAnnotations.ts'
import { isEditorRelativePath } from '@acorn/plugin-editor/contract/lineMarkers.ts'

type Core = Pick<CoreServices, 'tasks' | 'git'>

/** Editor asks about one line. The rest of a larger batch is ignored. */
const MAX_LINE_BLAME_KEYS = 8
const GIT_TIMEOUT_MS = 10_000
const BLAME_OUTPUT_BYTES = 64 * 1024
const LOG_OUTPUT_BYTES = 1024 * 1024
const COMMIT_CACHE_SIZE = 500
/** Keeps the detail under the host's 16 KiB cap even when every character takes three bytes. */
const MAX_MESSAGE_CHARS = 4_000
const REVISION = /^[0-9a-f]{64}$/
const COMMIT_ID = /^([0-9a-f]{40,64}) \d+ \d+/
const NOT_COMMITTED = 'You, not committed yet'

type Commit = { author: string; email: string; at: number; message: string }

/** The key as the host posted it, or null for one that names no line of a worktree file. */
function lineKey(value: unknown): EditorLineAnnotationKey | null {
  if (!value || typeof value !== 'object') return null
  const { taskId, path, line, revision } = value as Record<string, unknown>
  if (typeof taskId !== 'string' || !taskId) return null
  if (typeof path !== 'string' || !isEditorRelativePath(path)) return null
  if (typeof line !== 'number' || !Number.isSafeInteger(line) || line < 1) return null
  if (typeof revision !== 'string' || !REVISION.test(revision)) return null
  return { taskId, path, line, revision }
}

const hashOf = async (path: string): Promise<string | null> =>
  readFile(path)
    .then((bytes) => createHash('sha256').update(bytes).digest('hex'))
    .catch(() => null)

const AGE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 86_400],
  ['month', 30 * 86_400],
  ['week', 7 * 86_400],
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
]
const ageFormat = new Intl.RelativeTimeFormat('en', { numeric: 'always' })
const dateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

/** "4 years ago". Computed when the Node answers, so a label left on screen drifts until the next ask. */
export function relativeAge(atMs: number, nowMs: number): string {
  const seconds = Math.max(0, (nowMs - atMs) / 1000)
  for (const [unit, size] of AGE_UNITS) if (seconds >= size) return ageFormat.format(-Math.floor(seconds / size), unit)
  return 'just now'
}

// Author names and emails are plain text, so they can't add emphasis, code, or links to the detail.
// The host's renderer escapes HTML but has no backslash escapes, so the characters it reads as inline
// markup are dropped rather than escaped.
const plainText = (text: string): string => text.replace(/[`*[\]]/g, '').replace(/_{2,}/g, '_')

/** The tooltip: author and email, the full message, then the date, any `(#1234)` from the subject,
 *  and the short commit ID. The message is untrusted and goes as written; the host sanitizes it. */
function commitMarkdown(id: string, commit: Commit): string {
  const pullRequest = /\(#(\d+)\)\s*$/.exec(commit.message.split('\n', 1)[0] ?? '')?.[1]
  const message =
    commit.message.length > MAX_MESSAGE_CHARS ? `${commit.message.slice(0, MAX_MESSAGE_CHARS)}…` : commit.message
  const footer = [dateFormat.format(commit.at), pullRequest && `#${pullRequest}`, `\`${id.slice(0, 7)}\``]
    .filter(Boolean)
    .join(' · ')
  const author = plainText(commit.author)
  return [`${author ? `**${author}** ` : ''}<${plainText(commit.email)}>`, message.trim(), footer]
    .filter(Boolean)
    .join('\n\n')
}

/**
 * One blame reader per route. It keeps the details of up to 500 commits, oldest out first. A commit
 * never changes, so nothing in the cache goes stale.
 */
export function createLineBlame(core: Core, now: () => number = Date.now) {
  const commits = new Map<string, Commit>()
  const run = (root: string, args: string[], maxOutputBytes: number, signal: AbortSignal) =>
    core.git.git(args, { cwd: root, timeoutMs: GIT_TIMEOUT_MS, maxOutputBytes, signal })

  const commitFor = async (root: string, id: string, signal: AbortSignal): Promise<Commit | null> => {
    const cached = commits.get(id)
    if (cached) return cached
    const result = await run(
      root,
      ['log', '-1', '--no-show-signature', '--format=%an%x00%ae%x00%at%x00%B', id, '--'],
      LOG_OUTPUT_BYTES,
      signal,
    )
    if (result.code !== 0 || result.truncated) return null
    const [author = '', email = '', at = '', ...message] = result.stdout.split('\0')
    const commit = { author, email, at: Number(at) * 1000, message: message.join('\0').trim() }
    if (!Number.isFinite(commit.at)) return null
    commits.set(id, commit)
    if (commits.size > COMMIT_CACHE_SIZE) commits.delete(commits.keys().next().value!)
    return commit
  }

  const notCommitted = (key: EditorLineAnnotationKey): PluginAnnotationMark => ({
    key,
    severity: 'info',
    text: NOT_COMMITTED,
  })

  const blameLine = async (
    root: string,
    key: EditorLineAnnotationKey,
    signal: AbortSignal,
  ): Promise<PluginAnnotationMark | null> => {
    const blame = await run(
      root,
      ['blame', '--porcelain', '-L', `${key.line},${key.line}`, '--', key.path],
      BLAME_OUTPUT_BYTES,
      signal,
    )
    if (blame.code !== 0 || blame.truncated) {
      // Blame refuses a file that isn't in HEAD: an untracked or newly added file, or any file in a
      // repository with no commits. Every line of it is uncommitted.
      const inHead = await run(root, ['cat-file', '-e', `HEAD:${key.path}`], 1024, signal)
      return inHead.code === 0 ? null : notCommitted(key)
    }
    const id = COMMIT_ID.exec(blame.stdout)?.[1]
    if (!id) return null
    if (/^0+$/.test(id)) return notCommitted(key)
    const commit = await commitFor(root, id, signal)
    if (!commit) return null
    return {
      key,
      severity: 'info',
      text: `${commit.author}, ${relativeAge(commit.at, now())}`,
      detail: { kind: 'markdown', value: commitMarkdown(id, commit) },
    }
  }

  const answer = async (value: unknown, signal: AbortSignal): Promise<PluginAnnotationMark | null> => {
    const key = lineKey(value)
    if (!key) return null
    const root = await core.tasks.root(key.taskId)
    const abs = root && resolveInRoot(root, key.path)
    if (!root || !abs) return null
    if ((await hashOf(abs)) !== key.revision) return null
    const mark = await blameLine(root, key, signal)
    // The file may have changed while blame ran. Its answer would describe other text.
    return mark && (await hashOf(abs)) === key.revision ? mark : null
  }

  /** One mark per key that names a saved line, and nothing for the rest. */
  return async (keys: readonly unknown[], signal: AbortSignal): Promise<PluginAnnotationMark[]> => {
    const marks: PluginAnnotationMark[] = []
    for (const key of keys.slice(0, MAX_LINE_BLAME_KEYS)) {
      signal.throwIfAborted()
      // Blame is optional presentation, so a failure costs this key its mark and nothing else.
      const mark = await answer(key, signal).catch(() => null)
      if (mark) marks.push(mark)
    }
    return marks
  }
}
