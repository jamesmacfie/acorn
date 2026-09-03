import { createEffect, createMemo, createSignal, getOwner, onCleanup, untrack, type Accessor } from 'solid-js'
import { fuzzyScore } from '../../../kit/lib/paletteModel'
import {
  commandRegistry,
  executeCommand,
  isActionCommand,
  type CommandExecutionContext,
  type CommandOutcome,
} from './commands'
import { buildCommandGraph, type CommandGraph, type CommandNode } from './graph'
import { setCommandPresenter } from './presenter'

// The palette session: what is open, where in the tree it is, what is under the cursor, and what
// happens when somebody presses Enter (docs/future/command-palette/architecture.md § Palette
// session).
//
// One of these per client, and the same one for both. Before this, the desktop
// (../../palette/CommandPalette.tsx) and the terminal (apps/tui/src/chrome/Palette.tsx) each fetched
// the contributed rows, composed them with the actions and the task and workspace lists, filtered
// them, tracked which source owned which row, and invoked it — the same seven decisions, written
// twice, in two languages of component. Now they render this and bind keys to it. A renderer draws
// `rows()`, marks `selectedIndex()`, prints `breadcrumb()` and `status()`, and calls `activate()`,
// `move()` and `back()`. It fetches nothing and invokes nothing.
//
// Solid, but not DOM: signals and memos only, no JSX, so a bare-Node test and a cell renderer can
// both hold one. `tools/arch/boundaries.test.ts` keeps that line for the whole folder.
//
// What is deliberately *not* here yet: a query-dependent fetch, a submitted input, a setting's
// current value. Those are phase 2 and 3. What is here is the shape they arrive into — a frame
// stack, a generation counter and one abort controller — so they arrive without another rewrite.

/** What activating a row does. Owned by whoever produced the row, so the session never switches on
 *  what kind of thing a row is about. */
export type SessionRowAction =
  /** Push this command's own frame. A group, and later a search, an input or a setting. */
  | { effect: 'enter'; commandId: string }
  /** Run something. A leaf action and every compatibility row are both this. */
  | { effect: 'run'; run: (context: CommandExecutionContext) => Promise<CommandOutcome | void> | CommandOutcome | void }
  /** Nothing. An error line: visible, because it explains why a row somebody expected is missing,
   *  and never the selection. */
  | { effect: 'none' }

export type SessionRow = {
  /** Stable across a refresh: the selection is kept by this and not by an index. */
  readonly id: string
  readonly label: string
  readonly hint?: string
  /** The ancestor titles, without the row's own, when a root search reached a descendant. Absent
   *  everywhere else, because inside a group the breadcrumb is already the frame's. */
  readonly breadcrumb?: readonly string[]
  readonly action: SessionRowAction
}

export const rowSelectable = (row: SessionRow): boolean => row.action.effect !== 'none'

export type SessionRowBatch = {
  readonly rows: readonly SessionRow[]
  /** Reported apart from the rows, and floated to the top of the list, for the reason
   *  `../palette/paletteRows.ts` gives: an error explains why a row a reader expected is missing, and
   *  that is a property of the whole list rather than of one source. */
  readonly errors?: readonly { source: string; message: string }[]
}

/**
 * A row source that is not a command yet.
 *
 * Three of them exist and all three are compatibility: the `paletteRows` contributions
 * (../palette/provider.ts), go-to-task and switch-workspace. They go away as their owners become
 * commands, and this type goes with them (docs/future/command-palette/phase-6-cutover-and-documentation.md).
 *
 * Asked once when the session opens, with the context it captured. A provider that throws contributes
 * an error line rather than taking the list down.
 */
export type SessionRowProvider = {
  readonly id: string
  /** Where its rows sit relative to the commands, which are `COMMAND_ROW_ORDER`. */
  readonly order: number
  rows(context: CommandExecutionContext, signal: AbortSignal): Promise<SessionRowBatch> | SessionRowBatch
}

/** Where the command rows sit in the root list. The flat list put the actions between the contributed
 *  rows and the workspace and task rows, and this is that position as a number. */
export const COMMAND_ROW_ORDER = 500

/**
 * One level of the stack.
 *
 * The whole object is kept on push and restored on pop, which is the difference between "Escape goes
 * back" and "Escape goes back to exactly where you were": the query you had typed and the row you
 * were on are fields of this and not of the session.
 */
export type SessionFrame = {
  /** The command being shown, or `null` at the root. */
  readonly commandId: string | null
  readonly title: string | null
  /** Titles from the top level down to and including this frame's own. Empty at the root. */
  readonly breadcrumb: readonly string[]
  readonly query: string
  /** The row the cursor is on. `null` means "the first selectable one", which is what a fresh frame
   *  and a query that just changed both mean. */
  readonly selectedId: string | null
  /** A line under the field: what a `stay` outcome said, or what an activation threw. */
  readonly status: string
}

export type CommandSession = {
  open: Accessor<boolean>
  /** The identity captured when it opened, or `null` while closed. */
  context: Accessor<CommandExecutionContext | null>
  frames: Accessor<readonly SessionFrame[]>
  /** The frame on top, or `null` while closed. */
  frame: Accessor<SessionFrame | null>
  /** Where this frame is, from the top level down to and including its own title. Empty at the root,
   *  which is the one frame that is not a command. */
  breadcrumb: Accessor<readonly string[]>
  query: Accessor<string>
  status: Accessor<string>
  /** Something is being fetched or invoked. `aria-busy`, and the terminal's spinner. */
  busy: Accessor<boolean>
  rows: Accessor<readonly SessionRow[]>
  selectedIndex: Accessor<number>
  selectedRow: Accessor<SessionRow | null>
  openRoot: () => void
  /** Open at a command: a group at its own frame, a leaf at its parent's with the cursor on it. */
  openAt: (commandId: string) => void
  setQuery: (query: string) => void
  /** Put the cursor on a row by id. The renderer's hover and click path. */
  select: (id: string) => void
  /** Move the cursor, skipping the rows that are not selectable. Clamps at both ends, which is what
   *  both palettes do today. */
  move: (delta: number) => void
  /** Enter on the selected row. */
  activate: () => void
  /** Enter on a named row, for a click. */
  activateRow: (id: string) => void
  /** Escape: pop a frame, or close at the root. `true` when it popped. */
  back: () => boolean
  close: () => void
  /** Ask the providers again. The desktop calls it when the palette opens over a config edit. */
  refresh: () => void
}

export type CommandSessionOptions = {
  /** The identity to capture, read once per open. An external change to the node, workspace, project
   *  or task in it closes the session. */
  context: () => CommandExecutionContext
  providers?: () => readonly SessionRowProvider[]
  /** The host's half of opening: claim focus, raise the overlay. Runs only on a closed-to-open
   *  transition, so opening at a command while already open does not re-capture the focus target. */
  onOpen?: () => void
  /** The host's half of closing: hand focus back, drop the overlay. Runs once per close, and never on
   *  an intermediate pop. */
  onClose?: () => void
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const ROOT: SessionFrame = { commandId: null, title: null, breadcrumb: [], query: '', selectedId: null, status: '' }

const frameFor = (node: CommandNode): SessionFrame => ({
  commandId: node.id,
  title: node.title,
  breadcrumb: node.breadcrumb,
  query: '',
  selectedId: null,
  status: '',
})

/** The four identities a session is about. A pane or a surface moving under it is not a reason to
 *  close — opening a palette moves the focus itself — but the task, project, workspace or node it
 *  captured moving is: every row in the list was fetched for the old one. */
const sameIdentity = (a: CommandExecutionContext, b: CommandExecutionContext): boolean =>
  a.nodeId === b.nodeId && a.workspaceId === b.workspaceId && a.projectId === b.projectId && a.taskId === b.taskId

export function createCommandSession(options: CommandSessionOptions): CommandSession {
  const [open, setOpen] = createSignal(false)
  const [captured, setCaptured] = createSignal<CommandExecutionContext | null>(null)
  const [frames, setFrames] = createSignal<readonly SessionFrame[]>([])
  const [batches, setBatches] = createSignal<readonly { provider: SessionRowProvider; batch: SessionRowBatch }[]>([])
  const [loading, setLoading] = createSignal(false)
  const [pending, setPending] = createSignal(false)

  // One controller per open, and a generation per fetch. Abort is the optimisation and the generation
  // is the correctness: a provider that ignores its signal still cannot write into a session that has
  // moved on (docs/future/command-palette/architecture.md § Security and resource limits).
  let controller: AbortController | null = null
  let generation = 0

  const graph = createMemo<CommandGraph>(() => buildCommandGraph(commandRegistry.entries()))
  const frame = (): SessionFrame | null => frames()[frames().length - 1] ?? null

  const patchFrame = (patch: Partial<SessionFrame>): void => {
    setFrames((stack) => (stack.length ? [...stack.slice(0, -1), { ...stack[stack.length - 1], ...patch }] : stack))
  }

  // ── The rows ────────────────────────────────────────────────────────────────────────────────────

  const commandRow = (node: CommandNode, trail: boolean): SessionRow => ({
    id: node.id,
    label: node.title,
    hint: node.hint,
    breadcrumb: trail && node.breadcrumb.length > 1 ? node.breadcrumb.slice(0, -1) : undefined,
    action: isActionCommand(node.command)
      ? { effect: 'run', run: (context) => executeCommand(node.id, context) }
      : { effect: 'enter', commandId: node.id },
  })

  const errorRows = (): SessionRow[] =>
    batches().flatMap(({ provider, batch }) =>
      (batch.errors ?? []).map((error, at) => ({
        id: `error:${provider.id}:${at}`,
        label: `config error (${error.source}): ${error.message}`,
        action: { effect: 'none' } as const,
      })))

  const providerRows = (): { row: SessionRow; order: number }[] =>
    batches().flatMap(({ provider, batch }) => batch.rows.map((row) => ({ row, order: provider.order })))

  const rootRows = (query: string): SessionRow[] => {
    const trimmed = query.trim()
    if (!trimmed) {
      // The empty root, in the order the flat list had: contributed rows, then the commands, then the
      // workspace and task rows. `sort` is stable, so each provider's own row order survives.
      const ordered = [
        ...providerRows(),
        ...graph().top().map((node) => ({ row: commandRow(node, false), order: COMMAND_ROW_ORDER })),
      ].sort((a, b) => a.order - b.order)
      return [...errorRows(), ...ordered.map((entry) => entry.row)]
    }
    // A typed root searches descendants too, so a nested command stays findable by its breadcrumb.
    // Scored against the compatibility rows and interleaved with them, because a flat list is what the
    // reader still sees: showing every command above every task would be a new ranking nobody asked
    // for.
    const scored = [
      ...providerRows().map((entry) => ({ ...entry, score: fuzzyScore(trimmed, entry.row.label) })),
      ...graph().ranked(trimmed).map((hit) => ({ row: commandRow(hit.node, true), order: COMMAND_ROW_ORDER, score: hit.score })),
    ].filter((entry): entry is { row: SessionRow; order: number; score: number } => entry.score !== null)
    scored.sort((a, b) => b.score - a.score || a.order - b.order)
    return [...errorRows(), ...scored.map((entry) => entry.row)]
  }

  const groupRows = (commandId: string, query: string): SessionRow[] => {
    const trimmed = query.trim()
    if (!trimmed) return graph().children(commandId).map((node) => commandRow(node, false))
    // Its own children only. The root is the place that searches the whole tree; inside a group the
    // query narrows what is in front of you.
    return graph().ranked(trimmed)
      .filter((hit) => hit.node.parentId === commandId)
      .map((hit) => commandRow(hit.node, false))
  }

  const rows = createMemo<readonly SessionRow[]>(() => {
    if (!open()) return []
    const current = frame()
    if (!current) return []
    return current.commandId === null ? rootRows(current.query) : groupRows(current.commandId, current.query)
  })

  // ── The cursor ──────────────────────────────────────────────────────────────────────────────────

  const selectedIndex = createMemo(() => {
    const list = rows()
    const id = frame()?.selectedId ?? null
    const at = id === null ? -1 : list.findIndex((row) => row.id === id)
    // Kept by id where the row survived the refresh, and clamped to the first selectable row where it
    // did not — never left pointing at an error line.
    if (at >= 0 && rowSelectable(list[at])) return at
    return list.findIndex(rowSelectable)
  })

  const selectedRow = createMemo(() => rows()[selectedIndex()] ?? null)

  const select = (id: string): void => {
    const row = untrack(rows).find((candidate) => candidate.id === id)
    if (row && rowSelectable(row)) patchFrame({ selectedId: id })
  }

  const move = (delta: number): void => {
    const list = untrack(rows)
    const from = untrack(selectedIndex)
    const step = delta < 0 ? -1 : 1
    let at = from < 0 ? (step > 0 ? -1 : list.length) : from
    for (let left = Math.abs(delta); left > 0; left--) {
      let next = at + step
      while (next >= 0 && next < list.length && !rowSelectable(list[next])) next += step
      if (next < 0 || next >= list.length) break
      at = next
    }
    const row = list[at]
    if (row && rowSelectable(row)) patchFrame({ selectedId: row.id })
  }

  // ── Opening, fetching, closing ──────────────────────────────────────────────────────────────────

  const load = (): void => {
    const context = untrack(captured)
    const signal = controller?.signal
    if (!context || !signal) return
    const providers = [...(options.providers?.() ?? [])].sort((a, b) => a.order - b.order)
    if (!providers.length) {
      setBatches([])
      return
    }
    const mine = ++generation
    setLoading(true)
    void Promise.all(providers.map(async (provider) => {
      try {
        return { provider, batch: await provider.rows(context, signal) }
      } catch (error) {
        return { provider, batch: { rows: [], errors: [{ source: provider.id, message: messageOf(error) }] } }
      }
    })).then((next) => {
      // The generation check is what makes a slow provider harmless, and it is mandatory: a signal an
      // implementation ignores still cannot land here.
      if (mine !== generation) return
      setBatches(next)
      setLoading(false)
    })
  }

  const start = (stack: readonly SessionFrame[]): void => {
    const wasOpen = untrack(open)
    if (!wasOpen) {
      controller?.abort()
      controller = new AbortController()
      setCaptured(untrack(options.context))
      setBatches([])
    }
    setFrames(stack)
    if (!wasOpen) {
      setOpen(true)
      options.onOpen?.()
      load()
    }
  }

  const openRoot = (): void => start([ROOT])

  const openAt = (commandId: string): void => {
    const node = untrack(graph).nodes.get(commandId)
    if (!node || !node.available) return openRoot()
    const chain: CommandNode[] = []
    for (let at: CommandNode | undefined = node; at; at = at.parentId ? untrack(graph).nodes.get(at.parentId) : undefined) {
      chain.unshift(at)
    }
    // A group is entered at its own frame; a leaf has no frame of its own, so it is entered at its
    // parent's with the cursor on it. Both are "open the palette where this command is", which is what
    // a shortcut aimed at one means.
    const leaf = isActionCommand(node.command)
    start([ROOT, ...(leaf ? chain.slice(0, -1) : chain).map(frameFor)])
    if (leaf) patchFrame({ selectedId: node.id })
  }

  const close = (): void => {
    if (!untrack(open)) return
    controller?.abort()
    controller = null
    generation++
    setOpen(false)
    setPending(false)
    setLoading(false)
    setFrames([])
    setBatches([])
    setCaptured(null)
    options.onClose?.()
  }

  const back = (): boolean => {
    if (untrack(frames).length > 1) {
      // The parent frame object was never rebuilt, so its query and its cursor come back exactly as
      // they were. Focus is not handed back here: a pop is still inside the palette.
      setFrames((stack) => stack.slice(0, -1))
      return true
    }
    close()
    return false
  }

  // ── Activation ──────────────────────────────────────────────────────────────────────────────────

  const activateRow = (id: string): void => {
    if (untrack(pending)) return // one Enter at a time; a second while one is in flight is a slip
    const row = untrack(rows).find((candidate) => candidate.id === id)
    if (!row) return
    if (row.action.effect === 'none') return
    if (row.action.effect === 'enter') {
      const node = untrack(graph).nodes.get(row.action.commandId)
      if (node) setFrames((stack) => [...stack, frameFor(node)])
      return
    }
    const context = untrack(captured)
    if (!context) return
    patchFrame({ status: '' })
    setPending(true)
    const run = row.action.run
    void Promise.resolve()
      .then(() => run(context))
      .then((outcome) => {
        setPending(false)
        if (!outcome || outcome.effect === 'close') return close()
        patchFrame({ status: outcome.status ?? '' })
      })
      .catch((error: unknown) => {
        // An error keeps the frame open with the message on it. Before this the palette closed first
        // and set the message afterwards, into a surface nobody could see any more.
        setPending(false)
        patchFrame({ status: messageOf(error) })
      })
  }

  const activate = (): void => {
    const row = untrack(selectedRow)
    if (row) activateRow(row.id)
  }

  // ── The world moving underneath ─────────────────────────────────────────────────────────────────

  createEffect(() => {
    if (!open()) return
    const was = captured()
    if (!was) return
    if (sameIdentity(was, options.context())) return
    // A command that navigates gets to finish: it closes through its own outcome, and only then does
    // this see the move. Without the wait the observer would close first and the outcome would land on
    // a session that no longer exists, taking the error it was about to report with it.
    //
    // Read reactively rather than untracked, which is the whole of the mechanism: when the command
    // settles this runs again, and either the session has already closed on its outcome — in which
    // case the first line here is the answer — or it stayed open over an identity that has moved, and
    // then it closes.
    if (pending()) return
    close()
  })

  const session: CommandSession = {
    open,
    context: captured,
    frames,
    frame,
    breadcrumb: () => frame()?.breadcrumb ?? [],
    query: () => frame()?.query ?? '',
    status: () => frame()?.status ?? '',
    busy: () => pending() || loading(),
    rows,
    selectedIndex,
    selectedRow,
    openRoot,
    openAt,
    // A new query means a new list, so the cursor goes back to whatever is first rather than to a row
    // that may no longer be there.
    setQuery: (query) => patchFrame({ query, selectedId: null, status: '' }),
    select,
    move,
    activate,
    activateRow,
    back,
    close,
    refresh: load,
  }

  // The session is what a shortcut aimed at a group reaches (./presenter.ts). Registered here rather
  // than by each host, because a host that forgot would break the shortcut path silently.
  const presenting = setCommandPresenter({ openAt })
  if (getOwner()) onCleanup(() => presenting.dispose())

  return session
}
