// Each task's running background commands, for the Agent pane's chip and the terminal drawer's tabs
// (docs/managed-agents/background-commands.md). The chip and the tabs read this one list, so they
// always agree.
//
// A task's list is read from the Node the first time anyone asks for it. After that it follows the
// agent event frames every client already receives: a launch reads the list again, a settled status
// drops the command, and output goes to whichever tab is showing it. Nothing polls.
import { createSignal, untrack, type Signal } from 'solid-js'
import { onScopeEvicted, wsOnReconnect } from '@acorn/plugin-api/client'
import type { PtyIo } from '@acorn/plugin-api/ui'
import type { TerminalSuppliedTab, TerminalTabSupplier } from '@acorn/plugin-terminal/contract/suppliedTabs.ts'
import type { AgentBackgroundCommand, AgentEventRecord } from '../../contract/wire.ts'
import { toolCardKey } from '../../shared/toolFold'
import type { AgentServerFrame } from '../../shared/wsFrames'
import { managedAgentApi } from './managedClient'
import { managedAgentStore } from './managedStore'
import { wsOnAgentFrame } from './wsChannel'

/** A running background command, with the id its terminal tab goes by. */
type BackgroundCommand = AgentBackgroundCommand & { tabId: string; tab: TerminalSuppliedTab }

type TaskList = {
  commands: Signal<readonly BackgroundCommand[]>
  loaded: Signal<boolean>
  /** Counts reads, so only the newest one's answer is kept. */
  generation: number
}

const lists = new Map<string, TaskList>()
// Commands this window saw settle. A settled background command never runs again, so a list read that
// started before the settle frame arrived must not bring it back.
const settled = new Set<string>()
// List reads still out, which a settle frame has to be remembered against.
let loading = 0
// The tabs showing a command's output, by tab id.
const viewers = new Map<string, Set<(record: AgentEventRecord) => void>>()

// Prefixed, so it can't be a terminal session's id. The session is in it because a turnless card's
// key is only unique within its session.
const tabIdFor = (sessionId: string, turnId: string | null, toolCallId: string): string =>
  `background:${sessionId}:${toolCardKey(turnId, toolCallId)}`

// xterm moves down on a bare newline without going back to the start of the line, and a file or a
// pipe writes bare newlines. A PTY would have turned them into CRLF.
const terminalText = (text: string): string => text.replace(/\r?\n/g, '\r\n')
// Full reset, which clears the screen and the scrollback.
const RESET = '\x1bc'

function listFor(taskId: string): TaskList {
  let list = lists.get(taskId)
  if (!list) {
    list = { commands: createSignal<readonly BackgroundCommand[]>([]), loaded: createSignal(false), generation: 0 }
    lists.set(taskId, list)
    // Untracked, so the reader that asked doesn't follow the signals the read checks on its way out.
    void untrack(() => load(taskId))
  }
  return list
}

async function load(taskId: string): Promise<void> {
  const list = lists.get(taskId)
  if (!list) return
  const generation = ++list.generation
  const owner = managedAgentStore.captureRead()
  loading++
  // A Node without the route, or one that can't answer, has no commands to show.
  const answer = await managedAgentApi
    .backgroundCommands(taskId, owner)
    .catch(() => [])
    .finally(() => loading--)
  if (!owner.current() || lists.get(taskId) !== list || generation !== list.generation) return
  const held = new Map(untrack(list.commands[0]).map((command) => [command.tabId, command]))
  list.commands[1](
    answer.flatMap((row) => {
      const tabId = tabIdFor(row.sessionId, row.turnId, row.toolCallId)
      if (settled.has(tabId)) return []
      // The same object for a command the list already holds, so its tab keeps its identity.
      return [held.get(tabId) ?? command(row, tabId)]
    }),
  )
  list.loaded[1](true)
}

function command(row: AgentBackgroundCommand, tabId: string): BackgroundCommand {
  const io: PtyIo = {
    open: (_size, onEvent) => followOutput(row, tabId, (data) => onEvent({ kind: 'out', data })),
    input: () => {},
    resize: () => {},
  }
  return {
    ...row,
    tabId,
    tab: { id: tabId, title: row.title, icon: { name: 'bot', label: 'Agent background command' }, io },
  }
}

/**
 * Write what the card holds, then each change to it, until the returned stop.
 *
 * Frames that arrive while the first read is out are held, and the ones that read already folded in
 * are dropped by their seq, so no chunk is written twice.
 */
function followOutput(row: AgentBackgroundCommand, tabId: string, write: (data: string) => void): () => void {
  let readThrough: number | null = null
  let stopped = false
  const early: AgentEventRecord[] = []
  const apply = (record: AgentEventRecord): void => {
    if (record.event.type !== 'tool' || record.event.tool.output == null || record.seq <= readThrough!) return
    const { output, outputAppend } = record.event.tool
    // Past the cap the driver replaces the card's output with its newest part, so the view starts over.
    write(outputAppend ? terminalText(output) : RESET + terminalText(output))
  }
  const viewer = (record: AgentEventRecord): void => {
    if (readThrough === null) early.push(record)
    else apply(record)
  }
  let held = viewers.get(tabId)
  if (!held) viewers.set(tabId, (held = new Set()))
  held.add(viewer)

  const owner = managedAgentStore.captureRead()
  void managedAgentApi
    .toolCall(row.sessionId, row.toolCallId, owner)
    .then(
      (read) => {
        if (stopped || !owner.current()) return
        if (read.tool.output) write(terminalText(read.tool.output))
        return read.seq ?? 0
      },
      // Nothing to start from, so the view shows what arrives from here on.
      () => 0,
    )
    .then((through) => {
      if (stopped || through === undefined) return
      readThrough = through
      for (const record of early.splice(0)) apply(record)
    })

  return () => {
    stopped = true
    held.delete(viewer)
    if (!held.size) viewers.delete(tabId)
  }
}

function onFrame(frame: AgentServerFrame): void {
  if (frame.channel !== 'agent:event') return
  const record = frame.event as AgentEventRecord
  if (record.event.type !== 'tool') return
  const tool = record.event.tool
  const tabId = tabIdFor(record.sessionId, record.turnId, tool.id)
  for (const viewer of viewers.get(tabId) ?? []) viewer(record)
  if (tool.status && tool.status !== 'pending' && tool.status !== 'running') return settle(tabId)
  // A command going to the background. Codex says so with no status, and Claude with `running`.
  if (!tool.background || settled.has(tabId) || isKnown(tabId)) return
  // The frame doesn't name its task, so ask the roster. A session the roster hasn't heard of could be
  // any task's, which only a read of every list settles.
  const taskId = managedAgentStore.sessions().find((session) => session.id === record.sessionId)?.taskId
  if (taskId === undefined) for (const id of lists.keys()) void load(id)
  else if (lists.has(taskId)) void load(taskId)
}

const isKnown = (tabId: string): boolean =>
  [...lists.values()].some((list) => untrack(list.commands[0]).some((command) => command.tabId === tabId))

function settle(tabId: string): void {
  if (!loading && !isKnown(tabId)) return
  settled.add(tabId)
  for (const list of lists.values()) {
    const commands = untrack(list.commands[0])
    if (commands.some((command) => command.tabId === tabId))
      list.commands[1](commands.filter((command) => command.tabId !== tabId))
  }
}

/** The task's running background commands, oldest first, and whether its first read has landed. */
export function backgroundCommandsFor(taskId: string): { loaded: boolean; commands: readonly BackgroundCommand[] } {
  const list = listFor(taskId)
  return { loaded: list.loaded[0](), commands: list.commands[0]() }
}

/** What the agents plugin hands the terminal drawer: one read-only tab per running command. */
export const backgroundCommandTabs: TerminalTabSupplier = {
  tabs: (taskId) => {
    const { loaded, commands } = backgroundCommandsFor(taskId)
    return { loaded, tabs: commands.map((command) => command.tab) }
  },
}

/** Follows the frames and the socket. Returns the stop. */
export function activateBackgroundCommands(): () => void {
  const stopFrames = wsOnAgentFrame(onFrame)
  // Frames sent while the socket was down are gone, so every list reads again.
  const stopReconnect = wsOnReconnect(() => {
    for (const taskId of lists.keys()) void load(taskId)
  })
  return () => {
    stopReconnect()
    stopFrames()
  }
}

// Another Node's tasks and commands. A list still drawn reads again from the new Node.
onScopeEvicted((event) => {
  if (event.scope !== 'node-switched') return
  settled.clear()
  for (const [taskId, list] of lists) {
    list.commands[1]([])
    list.loaded[1](false)
    void load(taskId)
  }
})
