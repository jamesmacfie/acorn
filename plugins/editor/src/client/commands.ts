import type { CommandSearchItem } from '@acorn/protocol/commands.ts'
import {
  COMMAND_CLOSED,
  activeTaskId,
  dispatchLayout,
  fuzzyScore,
  openPane,
  type CommandExecutionContext,
  type CommandOutcome,
  type ContributedCommand,
} from '@acorn/plugin-api/client'
import { editorApi } from './editorClient'
import { editorOpen } from './editorState'

// ⌘P, and the two commands that were already here.
//
// Quick-open was an overlay of its own until 2026-09-03: a component in the shell's `overlay` slot
// running `createOverlayPalette`, with its own query, its own cursor, its own keybinding and its own
// list. It is a `search` command now, so the chord opens the one palette at this frame
// (client-core/host/registries/commands/presenter.ts) and the session owns the typing, the ordering,
// the cursor and the abort. Nothing about what it finds or what picking one does has changed — and
// the terminal client gains it, because it draws the same session and never drew that overlay
// (docs/tui.md § What a plugin loses here).
//
// **Why this ranks its own rows rather than using `localSearch`.** The adapter scores a row's title
// and subtitle separately, and a file row is a filename and its directory drawn as two things. A query
// like `client/App` spans the join, so scoring the halves would lose a match the overlay found. The
// whole path is what is scored here, exactly as before; the halves are only how the row reads.

const MAX_ROWS = 100 // Keep the list bounded on a repository with thousands of files.

/** One `git ls-files` per session, whatever gets typed after it. Keyed on the captured execution
 *  context, which is one object per open palette, so a session over another task lists that task. */
const listed = new WeakMap<CommandExecutionContext, Promise<readonly string[]>>()

const files = (context: CommandExecutionContext): Promise<readonly string[]> => {
  const cached = listed.get(context)
  if (cached) return cached
  const pending = editorApi().files(context.taskId ?? '')
  listed.set(context, pending)
  // A failed listing is not kept: Enter on the failure asks again rather than replaying it.
  void pending.catch(() => listed.delete(context))
  return pending
}

/** Filename first, then the directory that holds it: the name is what somebody typed and the path is
 *  how they tell two of them apart. The renderer draws `subtitle` muted after the label, on both
 *  hosts, which is what the overlay's own row did by hand. */
const fileItem = (path: string): CommandSearchItem => {
  const slash = path.lastIndexOf('/')
  return {
    id: path,
    title: slash >= 0 ? path.slice(slash + 1) : path,
    ...(slash >= 0 ? { subtitle: path.slice(0, slash) } : {}),
    ref: path,
  }
}

export const editorCommands: readonly ContributedCommand[] = [
  {
    id: 'editor.files.open',
    kind: 'search',
    title: 'Go to file',
    hint: 'open a file from this task’s worktree',
    keywords: ['quick open', 'file'],
    category: 'navigation',
    palette: true,
    scope: 'task',
    requires: { plugin: 'editor' },
    placeholder: 'Go to file…',
    // Nothing to wait for and nothing to type first: the list is one read of the worktree, held for as
    // long as the palette is open, and an empty query is the whole of it.
    minQueryLength: 0,
    debounceMs: 0,
    query: async (text, context) => {
      const all = await files(context)
      const query = text.trim()
      if (!query) return all.slice(0, MAX_ROWS).map(fileItem)
      // Every query character in order, contiguous runs and word starts scoring higher, ties keeping
      // the repository's own order — the scorer and the ordering the overlay used.
      return all
        .map((path, at) => ({ path, at, score: fuzzyScore(query, path) }))
        .filter((row): row is { path: string; at: number; score: number } => row.score !== null)
        .sort((a, b) => b.score - a.score || a.at - b.at)
        .slice(0, MAX_ROWS)
        .map((row) => fileItem(row.path))
    },
    select: (item, context): CommandOutcome => {
      const taskId = context.taskId
      if (!taskId || !item.ref) return COMMAND_CLOSED
      // Reveal the pane, then open an ephemeral preview tab, exactly as a single tree click does.
      // `EditorPane`'s active() effect swaps it in.
      dispatchLayout(taskId, { type: 'show', pane: 'editor' })
      editorOpen(taskId, item.ref, true)
      return COMMAND_CLOSED
    },
  },
  {
    // The entry point that keeps searching from starting with "open the editor first"
    // (docs/panes.md § Contributions).
    id: 'editor.search.open',
    title: 'Find in files…',
    category: 'navigation',
    palette: true,
    requires: { plugin: 'editor' },
    when: () => !!activeTaskId(),
    run: () => {
      const taskId = activeTaskId()
      if (taskId) openPane(taskId, 'editor', { kind: 'editor:search' }, 'add')
    },
  },
]
