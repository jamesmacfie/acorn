import type { JSX } from 'solid-js'
import type { CodeRow, DiffFile, DiffThread } from '../../kit/diff/model'
import type { DiffViewScope } from './viewState'

/** Which column a comment is anchored to. The renderer's own vocabulary, matching buildRenderableRows. */
export type CommentSide = 'LEFT' | 'RIGHT'

/**
 * Everything DiffPane needs from whoever owns the diff.
 *
 * The caller resolves its own queries and hands the results over, so the shell knows nothing about
 * GitHub pull requests or about a working tree. Two rules keep it that way: the members here are
 * plain accessors and callbacks, and an omitted optional member hides its affordance rather than
 * needing a stub. A source with no `fileText` renders gaps that cannot be expanded; a source with no
 * `reply` gets thread rows whose reply box is disabled.
 */
export type DiffSource = {
  /** Session-scoped identity for the remembered scroll offset and collapsed files. */
  scope: DiffViewScope
  /** Changed files in display order. Undefined until the first load resolves. */
  files: () => DiffFile[] | undefined
  loading: () => boolean
  /**
   * Which files are being shown. When this changes, parse state, expanded gaps, collapsed files and
   * the remembered scroll offset are all dropped, because they described a different diff.
   */
  signature: () => string
  /**
   * What those files currently say, when that can move without the set changing. Defaults to
   * `signature`.
   *
   * A change here re-reads the patches and leaves the scroll offset and the collapsed files alone,
   * because the reader is still looking at the same thing. A working tree needs the two apart: an
   * agent saving a file mid-review moves the content every poll, and treating that as a new diff
   * would throw the reader back to the top each time. A pull request does not: a new commit is both.
   */
  contentSignature?: () => string
  /** The file to scroll to. Empty means "wherever the remembered position was". */
  selectedPath: () => string
  /** Inline conversations, interleaved into the rows by path and line. */
  threads?: () => DiffThread[] | undefined
  /** Mention candidates for the comment composers. */
  mentions?: () => string[]
  /** A patch body already in hand, or null when it has to be fetched. */
  cachedFile: (path: string) => DiffFile | null
  /** Bodies still missing after cachedFile. Omit when every patch arrives with the file list. */
  fetchPatches?: (paths: string[], signal: AbortSignal | undefined) => Promise<DiffFile[]>
  /**
   * The new side of a file, whole, to fill a gap the reader expands. Omit and gaps render inert.
   *
   * Both halves of the argument come from the source's own `DiffFile`, so a source addresses the
   * content however it likes: GitHub passes a blob sha and ignores the path, and the changes pane
   * passes the staging area and reads the path out of the working tree.
   */
  fileText?: (file: { path: string; sha: string }) => Promise<string>
  /** True when a new line comment can be anchored. GitHub needs a head sha before it can. */
  canComment: () => boolean
  /**
   * Add a comment on one line. Required for the line composer to submit. The whole row comes along
   * rather than just its path and number, because a source may want the line's text: the changes
   * pane stores it with the note so the agent reading the note sees what it was written against.
   */
  addComment?: (body: string, anchor: { row: CodeRow; side: CommentSide; lineNo: number }) => Promise<unknown>
  /** Reply to a thread, addressed by its first comment. */
  reply?: (commentDatabaseId: number, body: string) => Promise<unknown>
  /** Resolve or unresolve a thread. */
  resolveThread?: (threadId: string, resolved: boolean) => Promise<unknown>
  /** Re-read the source after a mutation lands. */
  invalidate: () => void
  /** Namespace for the per-line composer drafts, so two surfaces never share one. */
  draftPrefix: string
  /**
   * Extra content under a code row, drawn inside the virtualized row so its height is measured.
   * This is the seam for an annotation the shell has no concept of, such as the changes pane's
   * review notes.
   */
  lineExtra?: (row: CodeRow) => JSX.Element
  /** Whether lineExtra would draw anything for this row. Read on every row, so keep it cheap. */
  hasLineExtra?: (row: CodeRow) => boolean
  /**
   * Changes whenever an annotation appears, goes, or changes height. A row is measured when it
   * mounts, so without this a note added to a row already on screen would grow it while the
   * virtualizer still held the one-line estimate, and the rows below it would overlap.
   */
  lineExtraSignature?: () => string
  /**
   * A click on a code line, for a source with a modifier-key affordance of its own. Unified mode
   * only: a split band holds two rows and cannot say which one the click landed on.
   */
  lineAction?: { title: string; run: (row: CodeRow, event: MouseEvent) => void }
  /**
   * The find command this pane registers. Each surface brings its own id so a reader's rebinding
   * survives, and its own pane so the chord resolves to the diff they are looking at. Omit `pane`
   * for a surface that owns the whole route.
   */
  find: { commandId: string; description: string; category: string; pane?: string }
}
