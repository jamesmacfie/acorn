import type { JSX } from 'solid-js'
import type { DiffDocumentTopology, DiffSearchPage, DiffSearchRequest, DiffSegmentPayload, DiffSegmentRequest } from '@acorn/diff-document/document'
import type { CodeRow, DiffThread } from '../../kit/diff/diffModel'
import type { DiffViewScope } from './viewState'

/** Which column a comment is anchored to. The renderer's own vocabulary, matching buildRenderableRows. */
export type CommentSide = 'LEFT' | 'RIGHT'

/** A line the source draws something under, known before any row is built. `old` is a deleted line's
 *  number, `new` any other line's. */
export type DiffLineAnchor = { path: string; side: 'old' | 'new'; line: number }

/**
 * Everything DiffPane needs from whoever owns the diff.
 *
 * The caller resolves its own queries and hands the results over, so the shell knows nothing about
 * GitHub pull requests or about a working tree. Two rules keep it that way: the members here are
 * plain accessors and callbacks, and an omitted optional member hides its affordance rather than
 * needing a stub. A source with no `fileText` renders gaps that cannot be expanded; a source with no
 * `reply` gets thread rows whose reply box is disabled.
 *
 * The diff itself arrives as a document (docs/diff-rendering.md § The source port): a topology that
 * lays out every file and segment without any source text, and segments of plain rows the viewer asks
 * for as the reader comes near them. The source never hands over a whole patch.
 */
export type DiffSource = {
  /** Session-scoped identity for the remembered scroll offset and collapsed files. */
  scope: DiffViewScope
  /** The document's layout. Undefined until the first load resolves. A new revision keeps every
   *  segment whose content key is unchanged and reloads only the ones that moved. */
  topology: () => DiffDocumentTopology | undefined
  loading: () => boolean
  /**
   * Which files are being shown. When this changes, expanded gaps, collapsed files and the remembered
   * scroll offset are all dropped, because they described a different diff. A working tree keeps this
   * steady while its files' content moves, so an agent saving a file mid-review does not throw the
   * reader back to the top; a pull request's moves with every new commit.
   */
  signature: () => string
  /** The file to scroll to. Empty means "wherever the remembered position was". */
  selectedPath: () => string
  /** Inline conversations, placed under the line they are anchored to. Complete when the topology is:
   *  a thread that appears later is counted as late topology by the health probe. */
  threads?: () => DiffThread[] | undefined
  /** Mention candidates for the comment composers. */
  mentions?: () => string[]
  /**
   * Plain rows for these segments, in any order. Asked for only near the viewport, a few at a time,
   * never for the whole document. Rejects when the segments can no longer be produced, such as a
   * working tree that moved under them; the viewer shows the segment as failed with a Retry, and the
   * source is expected to refresh its topology.
   */
  loadSegments: (requests: DiffSegmentRequest[], signal: AbortSignal) => Promise<DiffSegmentPayload[]>
  /** One page of find results across the whole document, as segment and row positions. */
  search: (request: DiffSearchRequest, signal: AbortSignal) => Promise<DiffSearchPage>
  /**
   * The new side of a file, whole, to fill a gap the reader expands. Omit and gaps render inert.
   *
   * Both halves of the argument come from the source's own topology file, so a source addresses the
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
   * Content the source draws under code lines, such as the changes pane's review notes. `anchors`
   * names every line that has some, up front, so the document can reserve for them before their
   * segments load; `render` draws one line's, inside its segment so the height is measured.
   */
  lineExtra?: { anchors: () => readonly DiffLineAnchor[]; render: (row: CodeRow) => JSX.Element }
  /**
   * A click on a code line, for a source with a modifier-key affordance of its own. Unified mode
   * only: a split band holds two rows and cannot say which one the click landed on.
   */
  lineAction?: { title: string; run: (row: CodeRow, event: MouseEvent) => void }
  /** Open an added line in the source's editor. Omit to hide the gutter control. */
  openLine?: (row: CodeRow) => void
  /**
   * The find command this pane registers. Each surface brings its own id so a reader's rebinding
   * survives, and its own pane so the chord resolves to the diff they are looking at. Omit `pane`
   * for a surface that owns the whole route.
   */
  find: { commandId: string; description: string; category: string; pane?: string }
}
