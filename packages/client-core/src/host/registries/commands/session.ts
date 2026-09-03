import { createEffect, createMemo, createSignal, getOwner, onCleanup, untrack, type Accessor } from 'solid-js'
import {
  DEFAULT_COMMAND_SEARCH_DEBOUNCE_MS,
  DEFAULT_COMMAND_SEARCH_MIN_QUERY,
  MAX_COMMAND_SEARCH_ITEMS,
  MAX_COMMAND_SEARCH_QUERY,
  type CommandSearchItem,
} from '@acorn/protocol/commands.ts'
import { fuzzyScore } from '../../../kit/lib/paletteModel'
import {
  commandRegistry,
  commandScope,
  executeCommand,
  isActionCommand,
  type CommandContribution,
  type CommandExecutionContext,
  type CommandOutcome,
  type InputCommand,
  type SearchCommand,
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
// Search and input arrived on 2026-09-03 into the shape phase 1 left for them: the frame stack holds
// their state, the generation counter decides whose answer is still wanted, and the abort controller
// belongs to whatever the top frame has in flight. A setting's current value is phase 3.

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
  /** A short marker beside the label: a count, a state, a severity. Only a search result has one so
   *  far, because only a search result comes from somewhere that knows one. */
  readonly badge?: string
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

/** What the top frame is for. The root and a group list commands; the other two are the interactive
 *  kinds, and each owns the field above the list rather than filtering it. */
export type SessionFrameKind = 'root' | 'group' | 'search' | 'input'

/** Where a search frame is between "nothing typed" and "here are the rows". */
export type SessionSearchPhase = 'instruction' | 'loading' | 'ready' | 'error'

/** One row a provider answered with, and the world it answered in. */
export type SessionSearchResult = {
  /** The row id, which is the item's own, namespaced by node under a fleet fan-out: two nodes may
   *  answer with the same issue key, and a bare item id would make one of them unreachable. */
  readonly rowId: string
  readonly item: CommandSearchItem
  /**
   * The identity this row was fetched under, which is what selecting it runs against.
   *
   * Its own rather than the session's, because a fleet query asks several nodes and a row from node B
   * picked in a session whose active node is A must still act on B.
   */
  readonly context: CommandExecutionContext
  readonly nodeLabel?: string
}

/**
 * A search frame's current answer.
 *
 * On the frame rather than on the session, for the same reason the query and the cursor are: the frame
 * object is kept whole on push and restored on pop, so a reader who leaves and comes back finds what
 * was there. `results` is emptied the moment a new query starts — a row fetched for `ro` is not a
 * result for `rol`, and leaving it selectable would let Enter act on the wrong thing.
 */
export type SessionSearchState = {
  readonly phase: SessionSearchPhase
  /** The one explanatory line when there are no rows: the minimum-length instruction, the loading
   *  line, or "no results". Empty when rows are showing. */
  readonly message: string
  readonly results: readonly SessionSearchResult[]
  /** Per-node failures. A fleet query that lost one node keeps the other's rows and says so, which is
   *  the convention every other fan-out surface already follows (infra/node/fanout.ts). */
  readonly errors: readonly { source: string; message: string }[]
}

/**
 * One level of the stack.
 *
 * The whole object is kept on push and restored on pop, which is the difference between "Escape goes
 * back" and "Escape goes back to exactly where you were": the query you had typed and the row you
 * were on are fields of this and not of the session.
 */
export type SessionFrame = {
  readonly kind: SessionFrameKind
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
  /** What this frame's own field asks for. Empty on the root and a group, where the host's own
   *  placeholder still describes the list. */
  readonly placeholder: string
  /** Present exactly on a search frame. */
  readonly search?: SessionSearchState
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
  /** What the top frame is: the root, a group, a search or an input. A renderer draws the same field
   *  and list for all four and reads this only to label the field and to know that Enter submits. */
  kind: Accessor<SessionFrameKind>
  query: Accessor<string>
  /** The top frame's own placeholder, or empty where the host's own still describes the list. */
  placeholder: Accessor<string>
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
  /**
   * A composition is in progress, or has just ended.
   *
   * An IME builds one character out of several keystrokes, and each of them reaches the field as an
   * input event. Searching on those spends a request per keystroke on text the reader has not typed
   * yet, so nothing is scheduled while this is true and the end of the composition schedules once
   * (docs/future/command-palette/architecture.md § Palette session).
   */
  setComposing: (composing: boolean) => void
  /** Run a failed search again, now. The error row is not selectable, so Enter on a failed frame comes
   *  here instead of activating it. */
  retry: () => void
}

/** One node a `fleet` search reaches, as the host's fan-out sees it. */
export type CommandFleetNode = { readonly nodeId: string; readonly label: string }

export type CommandSessionOptions = {
  /** The identity to capture, read once per open. An external change to the node, workspace, project
   *  or task in it closes the session. */
  context: () => CommandExecutionContext
  providers?: () => readonly SessionRowProvider[]
  /**
   * The nodes a `fleet`-scoped search asks, from the host's own fan-out.
   *
   * A host that supplies none is not refused: its answer is the one node it captured, which is what a
   * single-node client's whole fleet is (apps/tui). Nothing fans out without a command asking for it
   * (docs/future/command-palette/refused.md § Fleet search by default).
   */
  fleet?: () => readonly CommandFleetNode[]
  /** The host's half of opening: claim focus, raise the overlay. Runs only on a closed-to-open
   *  transition, so opening at a command while already open does not re-capture the focus target. */
  onOpen?: () => void
  /** The host's half of closing: hand focus back, drop the overlay. Runs once per close, and never on
   *  an intermediate pop. */
  onClose?: () => void
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const isAbort = (error: unknown): boolean => (error as { name?: string } | null)?.name === 'AbortError'

const ROOT: SessionFrame = {
  kind: 'root', commandId: null, title: null, breadcrumb: [], query: '', selectedId: null, status: '', placeholder: '',
}

const frameKind = (command: CommandContribution): SessionFrameKind =>
  command.kind === 'search' || command.kind === 'input' ? command.kind : 'group'

/** How much has to be typed before a search asks anybody. Zero is legitimate and is what a provider
 *  that loads once on entry and filters locally declares (./localSearch.ts). */
const minQueryOf = (command: SearchCommand): number =>
  Math.max(0, command.minQueryLength ?? DEFAULT_COMMAND_SEARCH_MIN_QUERY)

const debounceOf = (command: SearchCommand): number =>
  Math.max(0, command.debounceMs ?? DEFAULT_COMMAND_SEARCH_DEBOUNCE_MS)

/** What a search frame says before it has been asked anything. */
const instructionState = (command: SearchCommand): SessionSearchState => {
  const minimum = minQueryOf(command)
  return {
    phase: 'instruction',
    message: minimum > 0 ? `Type at least ${minimum} characters to search.` : '',
    results: [],
    errors: [],
  }
}

const frameFor = (node: CommandNode): SessionFrame => ({
  kind: frameKind(node.command),
  commandId: node.id,
  title: node.title,
  breadcrumb: node.breadcrumb,
  query: '',
  selectedId: null,
  status: '',
  placeholder: (node.command.kind === 'search' || node.command.kind === 'input' ? node.command.placeholder : '') ?? '',
  ...(node.command.kind === 'search' ? { search: instructionState(node.command) } : {}),
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
  // Two counters, because there are two kinds of work and they must not invalidate each other. `loads`
  // guards the providers' fetch, which belongs to the whole open session; `generation` guards whatever
  // the top frame has in flight. One counter meant that opening straight at a search frame bumped it
  // before the providers answered, and the root underneath came back with its rows missing.
  let loads = 0
  let generation = 0

  // The top frame's own in-flight work: one search, or one submission, never both. It is separate from
  // the controller above because the providers' fetch belongs to the whole open session, and a
  // keystroke that cancels a search must not cancel that.
  let work: AbortController | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  // Not a signal: nothing renders from it, and it is read only when a keystroke asks whether to
  // schedule.
  let composing = false

  /** Cancel whatever the top frame had going, and make its answer unwanted if it arrives anyway. */
  const abortWork = (): void => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    work?.abort()
    work = null
    generation++
  }

  // The graph is projected against the identity this session captured, so a command about a task is
  // simply not in a session that opened over no task (./graph.ts). Closed, there is no world to hold
  // the scopes against and the projection is the plain one.
  const graph = createMemo<CommandGraph>(() =>
    buildCommandGraph(commandRegistry.entries(), captured() ?? undefined))
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

  // ── The interactive frames ──────────────────────────────────────────────────────────────────────

  /** The command a frame is showing, when it is the kind the frame says it is. A frame outlives
   *  nothing — a disposed contribution simply stops answering — so every reader checks. */
  const commandFor = <K extends 'search' | 'input'>(frameAt: SessionFrame | null, kind: K):
    (K extends 'search' ? SearchCommand : InputCommand) | null => {
    if (!frameAt?.commandId || frameAt.kind !== kind) return null
    const command = commandRegistry.get(frameAt.commandId)
    if (!command || command.kind !== kind) return null
    return command as K extends 'search' ? SearchCommand : InputCommand
  }

  const searchRow = (result: SessionSearchResult): SessionRow => ({
    id: result.rowId,
    label: result.item.title,
    hint: [result.item.subtitle, result.nodeLabel].filter(Boolean).join(' · ') || undefined,
    ...(result.item.badge ? { badge: result.item.badge } : {}),
    action: {
      effect: 'run',
      // The context the row was fetched under, not the one handed in: under a fleet fan-out those are
      // different nodes, and the row belongs to the one that answered with it.
      run: () => {
        const command = commandFor(untrack(frame), 'search')
        return command ? command.select(result.item, result.context) : undefined
      },
    },
  })

  const searchRows = (state: SessionSearchState): SessionRow[] => {
    const failures = state.errors.map((error, at) => ({
      id: `error:${error.source}:${at}`,
      label: `${error.source}: ${error.message}`,
      action: { effect: 'none' } as const,
    }))
    const found = state.results.map(searchRow)
    if (failures.length || found.length) return [...failures, ...found]
    // One explanatory line, and never a selectable one: it says why the list is empty rather than
    // offering something to press Enter on.
    return state.message ? [{ id: 'search:message', label: state.message, action: { effect: 'none' } }] : []
  }

  const inputRows = (submitting: boolean): SessionRow[] => [{
    id: 'input:hint',
    // The pending state, visible in both hosts without either of them branching on a frame kind.
    label: submitting ? 'Submitting…' : 'Press Enter to submit.',
    action: { effect: 'none' },
  }]

  const rows = createMemo<readonly SessionRow[]>(() => {
    if (!open()) return []
    const current = frame()
    if (!current) return []
    if (current.kind === 'search') return current.search ? searchRows(current.search) : []
    if (current.kind === 'input') return inputRows(pending())
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

  // ── Searching ───────────────────────────────────────────────────────────────────────────────────

  /** Which worlds one query is asked in: the captured one, or one per capable node under `fleet`. */
  const searchTargets = (command: SearchCommand, base: CommandExecutionContext): readonly { context: CommandExecutionContext; label?: string }[] => {
    if (commandScope(command) !== 'fleet') return [{ context: base }]
    const fleet = options.fleet?.() ?? []
    if (!fleet.length) return [{ context: base }]
    return fleet.map((node) => ({ context: { ...base, nodeId: node.nodeId }, label: node.label }))
  }

  const applySearch = (state: SessionSearchState): void => patchFrame({ search: state, selectedId: null })

  /**
   * Ask, once the reader has stopped typing.
   *
   * The generation is taken here rather than when the answer lands, and every path back into the frame
   * checks it. A provider that ignores its signal — a fetch already past the network, a cache that
   * resolves from memory — still cannot write rows for `ro` into a frame that now says `rol`.
   */
  const runSearch = (command: SearchCommand, text: string): void => {
    const base = untrack(captured)
    if (!base) return
    abortWork()
    const controllerForQuery = new AbortController()
    work = controllerForQuery
    const mine = generation
    const targets = searchTargets(command, base)
    // A fan-out is what carries node labels, and it is what namespaces a row id — including a fleet of
    // one, so the id a row has does not depend on how many machines happen to be paired today.
    const fleet = targets.some((target) => target.label !== undefined)
    void Promise.all(targets.map(async (target) => {
      try {
        return { target, items: await command.query(text, target.context, controllerForQuery.signal) }
      } catch (error) {
        return { target, error }
      }
    })).then((settled) => {
      // Both, and in this order: a stale generation means somebody else owns the frame now, and an
      // aborted controller means this answer was already given up on.
      if (mine !== generation || controllerForQuery.signal.aborted) return
      const results: SessionSearchResult[] = []
      const errors: { source: string; message: string }[] = []
      for (const outcome of settled) {
        const label = outcome.target.label
        if ('error' in outcome) {
          // An abort is silent. It is this session cancelling its own work, and reporting it back to
          // the reader as a failure would put an error line under every keystroke.
          if (!isAbort(outcome.error)) errors.push({ source: label ?? 'search', message: messageOf(outcome.error) })
          continue
        }
        for (const item of outcome.items) {
          if (results.length >= MAX_COMMAND_SEARCH_ITEMS) break
          results.push({
            rowId: fleet ? `${outcome.target.context.nodeId ?? ''}:${item.id}` : item.id,
            item,
            context: outcome.target.context,
            ...(label ? { nodeLabel: label } : {}),
          })
        }
      }
      // A partial failure keeps the rows it did get: one node that went away must not erase the other's
      // answers (infra/node/fanout.ts § the same rule for every aggregate surface).
      const failedOutright = !results.length && errors.length > 0
      applySearch({
        phase: failedOutright ? 'error' : 'ready',
        message: results.length || errors.length ? '' : 'No results.',
        results,
        errors,
      })
    })
  }

  /**
   * A keystroke, an entry, or a composition ending.
   *
   * Whatever was in flight is dropped first and the rows go with it, because a row fetched for the
   * previous query is not an answer to this one and leaving it selectable would let Enter act on the
   * wrong thing. What replaces it is a state, not a row: too short is an instruction, in flight is a
   * loading line, and only a landed answer is a list.
   */
  const scheduleSearch = (): void => {
    const current = untrack(frame)
    const command = commandFor(current, 'search')
    if (!current || !command) return
    abortWork()
    const text = current.query.trim().slice(0, MAX_COMMAND_SEARCH_QUERY)
    if (text.length < minQueryOf(command)) return applySearch(instructionState(command))
    // Mid-character. The composition's end schedules once, with whatever the field says then.
    if (composing) return applySearch({ ...instructionState(command), message: '' })
    applySearch({ phase: 'loading', message: 'Searching…', results: [], errors: [] })
    const mine = generation
    timer = setTimeout(() => {
      timer = null
      if (mine !== generation) return
      runSearch(command, text)
    }, debounceOf(command))
  }

  const retry = (): void => {
    const current = untrack(frame)
    const command = commandFor(current, 'search')
    if (!current || !command) return
    const text = current.query.trim().slice(0, MAX_COMMAND_SEARCH_QUERY)
    if (text.length < minQueryOf(command)) return applySearch(instructionState(command))
    applySearch({ phase: 'loading', message: 'Searching…', results: [], errors: [] })
    runSearch(command, text)
  }

  // ── Submitting ──────────────────────────────────────────────────────────────────────────────────

  /**
   * Enter on an input frame, once.
   *
   * Never debounced and never implicit: the reader types a line and presses Enter, and a second Enter
   * while the first is in flight is a slip rather than a second submission. A failure keeps the frame,
   * the text and the message, because the whole point of typing it was not to have to type it again.
   */
  const submitInput = (): void => {
    if (untrack(pending)) return
    const current = untrack(frame)
    const command = commandFor(current, 'input')
    if (!current || !command) return
    const text = current.query.trim()
    if (!text) return
    const problem = command.validate?.(text)
    if (problem !== undefined) return patchFrame({ status: problem })
    const context = untrack(captured)
    if (!context) return
    abortWork()
    const controllerForSubmit = new AbortController()
    work = controllerForSubmit
    const mine = generation
    patchFrame({ status: '' })
    setPending(true)
    // Called now, not on the next microtask: the reader pressed Enter, and the request, its signal and
    // the pending row all have to exist by the time the second Enter arrives.
    void (async (): Promise<void> => {
      try {
        const outcome = await command.submit(text, context, controllerForSubmit.signal)
        // Somebody else owns the frame now — a pop, a close, the world moving. Whatever this was going
        // to say, there is nowhere to say it.
        if (mine !== generation) return
        setPending(false)
        if (!outcome || outcome.effect === 'close') return close()
        patchFrame({ status: outcome.status ?? '' })
      } catch (error) {
        if (mine !== generation) return
        setPending(false)
        if (isAbort(error)) return
        patchFrame({ status: messageOf(error) })
      }
    })()
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
    const mine = ++loads
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
      if (mine !== loads) return
      setBatches(next)
      setLoading(false)
    })
  }

  /** Landing on a frame. A search asks straight away, which is what a provider with no minimum and no
   *  debounce means by "loads once on entry" (./localSearch.ts); everything else has nothing to ask. */
  const entered = (): void => {
    if (untrack(frame)?.kind === 'search') scheduleSearch()
  }

  const start = (stack: readonly SessionFrame[]): void => {
    const wasOpen = untrack(open)
    abortWork()
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
    entered()
  }

  const openRoot = (): void => start([ROOT])

  const openAt = (commandId: string): void => {
    // The graph as this session is about to see it. A shortcut arrives before anything has been
    // captured, and a command the identity would hide — a task command with no task open — is not one
    // this session can open at, so the projection it is looked up in is the one it will live in.
    const projected = untrack(open)
      ? untrack(graph)
      : buildCommandGraph(commandRegistry.entries(), untrack(options.context))
    const node = projected.nodes.get(commandId)
    if (!node || !node.available) return openRoot()
    const chain: CommandNode[] = []
    for (let at: CommandNode | undefined = node; at; at = at.parentId ? projected.nodes.get(at.parentId) : undefined) {
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
    abortWork()
    controller?.abort()
    controller = null
    loads++
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
      // Whatever the frame being left had in flight goes with it. A search whose answer arrives after
      // Escape has nowhere to put it, and the generation makes sure it cannot find one. The pending
      // flag goes with it too, or the frame underneath would refuse the next Enter forever.
      abortWork()
      setPending(false)
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
      if (!node) return
      setFrames((stack) => [...stack, frameFor(node)])
      entered()
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
    const current = untrack(frame)
    // Enter means "submit" on an input frame, whatever the list underneath says: its rows are
    // explanatory and none of them is selectable.
    if (current?.kind === 'input') return submitInput()
    const row = untrack(selectedRow)
    if (row) return activateRow(row.id)
    // A failed search has an error row and no selectable one, so Enter is the retry. Nothing else has
    // a meaning for Enter with nothing under the cursor.
    if (current?.kind === 'search' && current.search?.phase === 'error') retry()
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
    kind: () => frame()?.kind ?? 'root',
    query: () => frame()?.query ?? '',
    placeholder: () => frame()?.placeholder ?? '',
    status: () => frame()?.status ?? '',
    // A search waiting on its provider is busy too, and the loading row says so where a spinner cannot.
    busy: () => pending() || loading() || frame()?.search?.phase === 'loading',
    rows,
    selectedIndex,
    selectedRow,
    openRoot,
    openAt,
    // A new query means a new list, so the cursor goes back to whatever is first rather than to a row
    // that may no longer be there. On a search frame it also means a new question, which is the one
    // place a keystroke reaches the network.
    setQuery: (query) => {
      patchFrame({ query, selectedId: null, status: '' })
      scheduleSearch()
    },
    select,
    move,
    activate,
    activateRow,
    back,
    close,
    refresh: load,
    setComposing: (value) => {
      const was = composing
      composing = value
      if (was && !value) scheduleSearch()
    },
    retry,
  }

  // The session is what a shortcut aimed at a group reaches (./presenter.ts). Registered here rather
  // than by each host, because a host that forgot would break the shortcut path silently.
  const presenting = setCommandPresenter({ openAt })
  if (getOwner()) {
    onCleanup(() => {
      presenting.dispose()
      // A session going away takes its work with it: the host that owned it is unmounting, and a
      // provider still holding the signal is the one thing that could keep talking to a node about a
      // window nobody is looking at.
      abortWork()
      controller?.abort()
      controller = null
    })
  }

  return session
}
