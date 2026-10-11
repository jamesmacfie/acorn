import type { CommandSearchItem } from '@acorn/protocol/commands.ts'
import {
  COMMAND_CLOSED,
  activeNodeId,
  activeTaskId,
  fuzzyScore,
  openPane,
  type CommandExecutionContext,
  type CommandOutcome,
  type ContributedCommand,
} from '@acorn/plugin-api/client'
import { editorApi, editorApiForNode } from './editorClient'
import { activeFile, requestEditorReveal } from './editorState'
import { pruneRecentToListing } from './editorNavigation'
import { graphicalEditorAdmitted } from './editorAdmission'
import { collapseEditorTreeDirectories, editorTreeCollectionId, captureEditorTreeFolder } from './editorTreeState'
import { findInFolder } from './search/searchState'
import { focusedPane } from '@acorn/plugin-api/client'

// ⌘P, and the two commands that were already here.
//
// Quick-open was an overlay of its own until 2026-09-03: a component in the shell's `overlay` slot
// running `createOverlayPalette`, with its own query, its own cursor, its own keybinding and its own
// list. It is a `search` command now, so the chord opens the one palette at this frame
// (client-core/host/registries/commands/presenter.ts) and the session owns the typing, the ordering,
// the cursor and the abort. Nothing about what it finds or what picking one does has changed — and
// the terminal client gains it, because it draws the same session and never drew that overlay
// (docs/tui/plugin-losses.md § What a plugin loses here).
//
// **Why this ranks its own rows rather than using `localSearch`.** The adapter scores a row's title
// and subtitle separately, and a file row is a filename and its directory drawn as two things. A query
// like `client/App` spans the join, so scoring the halves would lose a match the overlay found. The
// whole path is what is scored here, exactly as before; the halves are only how the row reads.

const MAX_ROWS = 100 // Keep the list bounded on a repository with thousands of files.

/** One `git ls-files` per session, whatever gets typed after it. Keyed on the captured execution
 *  context, which is one object per open palette, so a session over another task lists that task. */
const listed = new WeakMap<CommandExecutionContext, Promise<readonly string[]>>()
const positions = new WeakMap<CommandSearchItem, { line: number; column?: number }>()
const fileItems = new WeakMap<CommandSearchItem, CommandExecutionContext>()
const lineItems = new WeakMap<
  CommandSearchItem,
  { context: CommandExecutionContext; path: string; line: number; column: number }
>()

function splitPosition(query: string, paths: readonly string[]): { query: string; line?: number; column?: number } {
  if (paths.includes(query)) return { query }
  const match = /^(.*):([1-9]\d*):([1-9]\d*)$/.exec(query) ?? /^(.*):([1-9]\d*)$/.exec(query)
  if (!match) return { query }
  const line = Number(match[2])
  const column = match[3] === undefined ? undefined : Number(match[3])
  if (!Number.isSafeInteger(line) || (column !== undefined && !Number.isSafeInteger(column))) return { query }
  return { query: match[1], line, column }
}

const files = (context: CommandExecutionContext): Promise<readonly string[]> => {
  const cached = listed.get(context)
  if (cached) return cached
  const pending =
    context.nodeId === activeNodeId() && context.taskId ? editorApi().files(context.taskId) : Promise.resolve([])
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
    id: 'editor.tree.collapse',
    title: 'Collapse all folders',
    category: 'navigation',
    palette: true,
    scope: 'task',
    requires: { plugin: 'editor' },
    when: () => !!activeTaskId(),
    run: (context) => {
      if (context.nodeId === activeNodeId() && context.taskId === activeTaskId() && context.taskId)
        collapseEditorTreeDirectories(context.taskId, context.nodeId)
    },
  },
  {
    id: 'editor.tree.reveal-active',
    title: 'Reveal active file',
    category: 'navigation',
    palette: true,
    scope: 'task',
    requires: { plugin: 'editor' },
    when: () => {
      const taskId = activeTaskId()
      return !!taskId && !!activeFile(taskId)
    },
    run: (context) => {
      if (context.nodeId !== activeNodeId() || context.taskId !== activeTaskId() || !context.taskId) return
      const path = activeFile(context.taskId)
      if (path) openPane(context.taskId, 'editor', { kind: 'editor:tree-reveal', path }, 'add')
    },
  },
  {
    id: 'editor.search.folder',
    title: 'Find in focused folder',
    category: 'navigation',
    palette: true,
    scope: 'task',
    requires: { plugin: 'editor' },
    when: (context) =>
      !!context?.taskId &&
      context.taskId === activeTaskId() &&
      context.nodeId === activeNodeId() &&
      context.focusedCollection?.id === editorTreeCollectionId(context.taskId, context.nodeId) &&
      !!captureEditorTreeFolder(context.taskId, context.nodeId, context.focusedCollection.key),
    run: async (context) => {
      const path =
        context.taskId && context.focusedCollection?.id === editorTreeCollectionId(context.taskId, context.nodeId)
          ? context.focusedCollection.key
          : undefined
      if (!path || !context.taskId || context.nodeId !== activeNodeId() || context.taskId !== activeTaskId()) return
      const current = captureEditorTreeFolder(context.taskId, context.nodeId, path)
      if (!current) return
      const target = await editorApiForNode(context.nodeId).entry(context.taskId, path)
      if (
        target.kind === 'folder' &&
        current() &&
        context.nodeId === activeNodeId() &&
        context.taskId === activeTaskId()
      )
        findInFolder(context.taskId, path, context.nodeId)
    },
  },
  {
    id: 'editor.files.open',
    kind: 'search',
    title: 'Go to file',
    hint: 'open a file in this task',
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
      if (context.nodeId !== activeNodeId()) return []
      const parsed = splitPosition(text.trim(), all)
      const query = parsed.query
      const ranked = !query
        ? [...pruneRecentToListing(context.nodeId, context.taskId ?? '', all), ...all]
        : all.includes(query)
          ? [query]
          : all
              .map((path, at) => ({ path, at, score: fuzzyScore(query, path) }))
              .filter((row): row is { path: string; at: number; score: number } => row.score !== null)
              .sort((a, b) => b.score - a.score || a.at - b.at)
              .map((row) => row.path)
      // Every query character in order, contiguous runs and word starts scoring higher, ties keeping
      // the repository's own order — the scorer and the ordering the overlay used.
      return [...new Set(ranked)].slice(0, MAX_ROWS).map((path) => {
        const item = fileItem(path)
        fileItems.set(item, context)
        if (parsed.line) positions.set(item, { line: parsed.line, column: parsed.column })
        return item
      })
    },
    select: (item, context): CommandOutcome => {
      const taskId = context.taskId
      if (
        !taskId ||
        !item.ref ||
        fileItems.get(item) !== context ||
        context.nodeId !== activeNodeId() ||
        context.taskId !== activeTaskId()
      )
        return COMMAND_CLOSED
      // Reveal the pane, then open an ephemeral preview tab, exactly as a single tree click does.
      // `EditorPane`'s active() effect swaps it in.
      const position = positions.get(item)
      requestEditorReveal(taskId, item.ref, position?.line ?? 1, position?.column)
      return COMMAND_CLOSED
    },
  },
  {
    id: 'editor.navigation.go-to-line',
    kind: 'search',
    title: 'Go to line',
    category: 'navigation',
    palette: true,
    scope: 'task',
    requires: { plugin: 'editor' },
    when: () => {
      const taskId = activeTaskId()
      const path = taskId && activeFile(taskId)
      return (
        !!taskId && !!path && focusedPane(taskId) === 'editor' && graphicalEditorAdmitted(activeNodeId(), taskId, path)
      )
    },
    placeholder: 'Line or line:column…',
    minQueryLength: 1,
    debounceMs: 0,
    query: async (text, context) => {
      if (
        context.nodeId !== activeNodeId() ||
        !context.taskId ||
        !activeFile(context.taskId) ||
        !graphicalEditorAdmitted(context.nodeId, context.taskId, activeFile(context.taskId)!)
      )
        return []
      const match = /^([1-9]\d*)(?::([1-9]\d*))?$/.exec(text.trim())
      if (!match) return []
      const line = Number(match[1])
      const column = match[2] ? Number(match[2]) : 1
      if (!Number.isSafeInteger(line) || !Number.isSafeInteger(column)) return []
      const path = activeFile(context.taskId)!
      const item = { id: `${path}:${line}:${column}`, title: `Line ${line}, column ${column}`, ref: path }
      lineItems.set(item, { context, path, line, column })
      return [item]
    },
    select: (item, context): CommandOutcome => {
      const selected = lineItems.get(item)
      if (
        context.nodeId !== activeNodeId() ||
        context.taskId !== activeTaskId() ||
        !context.taskId ||
        selected?.context !== context ||
        selected.path !== item.ref ||
        !graphicalEditorAdmitted(context.nodeId, context.taskId, selected.path)
      )
        return COMMAND_CLOSED
      requestEditorReveal(context.taskId, selected.path, selected.line, selected.column)
      return COMMAND_CLOSED
    },
  },
  {
    // The entry point that keeps searching from starting with "open the editor first"
    // (docs/panes/contributions.md § Contributions).
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
