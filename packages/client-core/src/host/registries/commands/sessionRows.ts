import type { CommandSettingOption } from '@acorn/protocol/commands.ts'
import { fuzzyScore } from '../../../kit/lib/controls/fuzzy'
import { isActionCommand, type CommandExecutionContext, type CommandOutcome, type SettingCommand } from './commands'
import type { CommandGraph, CommandNode, CommandNodeHit } from './graph'
import type { SessionRow, SessionSearchResult, SessionSearchState, SessionSettingState } from './sessionStore'

type Execute = (
  commandId: string,
  context: CommandExecutionContext,
) => Promise<CommandOutcome | void> | CommandOutcome | void

/** Each command's decayed use, read once when the session opened (./usage.ts). */
type Usage = ReadonlyMap<string, number>

const commandRow = (node: CommandNode, trail: boolean, execute: Execute): SessionRow => ({
  id: node.id,
  label: node.title,
  hint: node.hint,
  breadcrumb: trail && node.breadcrumb.length > 1 ? node.breadcrumb.slice(0, -1) : undefined,
  action: isActionCommand(node.command)
    ? { effect: 'run', run: (context) => execute(node.id, context) }
    : { effect: 'enter', commandId: node.id },
})

/** Recent rows at the empty root. Enough to reach a habit without pushing the top level off a short
 *  screen. */
const MAX_RECENT_ROWS = 5

/** Equal text matches, most used first. `ranked` already applied the author's order, and a stable sort
 *  keeps it under whatever use doesn't decide. */
const byUse = (hits: readonly CommandNodeHit[], usage: Usage): CommandNodeHit[] =>
  [...hits].sort((a, b) => b.score - a.score || (usage.get(b.node.id) ?? 0) - (usage.get(a.node.id) ?? 0))

/** The most used commands this context can reach. The row id differs from the command's, so one that is
 *  also a top-level row doesn't put two rows with one id in the list. */
const recentRows = (graph: CommandGraph, usage: Usage, execute: Execute): SessionRow[] =>
  [...usage]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => graph.nodes.get(id))
    .filter((node): node is CommandNode => !!node?.discoverable)
    .slice(0, MAX_RECENT_ROWS)
    .map((node) => ({ ...commandRow(node, true, execute), id: `recent:${node.id}`, badge: 'recent' }))

export const rootRows = (graph: CommandGraph, query: string, execute: Execute, usage: Usage): SessionRow[] => {
  const trimmed = query.trim()
  if (!trimmed) {
    return [...recentRows(graph, usage, execute), ...graph.top().map((node) => commandRow(node, false, execute))]
  }
  return byUse(graph.ranked(trimmed), usage).map((hit) => commandRow(hit.node, true, execute))
}

// An empty group keeps the author's order. Its rows are a short list that people learn by position.
export const groupRows = (
  graph: CommandGraph,
  commandId: string,
  query: string,
  execute: Execute,
  usage: Usage,
): SessionRow[] => {
  const trimmed = query.trim()
  if (!trimmed) return graph.children(commandId).map((node) => commandRow(node, false, execute))
  return byUse(
    graph.ranked(trimmed).filter((hit) => hit.node.parentId === commandId),
    usage,
  ).map((hit) => commandRow(hit.node, false, execute))
}

export const searchRows = (
  state: SessionSearchState,
  select: (result: SessionSearchResult) => Promise<CommandOutcome | void> | CommandOutcome | void,
): SessionRow[] => {
  const failures: SessionRow[] = state.errors.map((error, at) => ({
    id: `error:${error.source ?? 'search'}:${at}`,
    label: `Couldn't search${error.source ? ` ${error.source}` : ''}. ${error.message}`,
    action: { effect: 'none' },
  }))
  const found: SessionRow[] = state.results.map((result) => ({
    id: result.rowId,
    label: result.item.title,
    hint: [result.item.subtitle, result.nodeLabel].filter(Boolean).join(' · ') || undefined,
    ...(result.item.badge ? { badge: result.item.badge } : {}),
    action: { effect: 'run', run: () => select(result) },
  }))
  if (failures.length || found.length) return [...failures, ...found]
  return state.message ? [{ id: 'search:message', label: state.message, action: { effect: 'none' } }] : []
}

export const inputRows = (submitting: boolean): SessionRow[] => [
  {
    id: 'input:hint',
    label: submitting ? 'Submitting…' : 'Press Enter to submit.',
    action: { effect: 'none' },
  },
]

const settingRow = (
  option: CommandSettingOption,
  current: string | null,
  write: (option: CommandSettingOption, context: CommandExecutionContext) => Promise<CommandOutcome>,
): SessionRow => ({
  id: `setting:${option.value}`,
  label: option.label,
  ...(option.value === current ? { badge: 'current' } : {}),
  action: { effect: 'run', run: (context) => write(option, context) },
})

export const settingRows = (
  command: SettingCommand,
  state: SessionSettingState,
  query: string,
  write: (option: CommandSettingOption, context: CommandExecutionContext) => Promise<CommandOutcome>,
): SessionRow[] => {
  if (state.phase !== 'ready') {
    return state.message ? [{ id: 'setting:message', label: state.message, action: { effect: 'none' } }] : []
  }
  const trimmed = query.trim()
  if (!trimmed) return command.options.map((option) => settingRow(option, state.value, write))
  return command.options
    .map((option, at) => ({
      option,
      at,
      score: [option.label, ...(option.keywords ?? [])]
        .map((text) => fuzzyScore(trimmed, text))
        .reduce<number | null>((best, hit) => (hit === null ? best : best === null ? hit : Math.max(best, hit)), null),
    }))
    .filter((row): row is { option: CommandSettingOption; at: number; score: number } => row.score !== null)
    .sort((a, b) => b.score - a.score || a.at - b.at)
    .map((row) => settingRow(row.option, state.value, write))
}
