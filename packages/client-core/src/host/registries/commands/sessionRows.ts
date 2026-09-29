import type { CommandSettingOption } from '@acorn/protocol/commands.ts'
import { fuzzyScore } from '../../../kit/lib/controls/fuzzy'
import {
  isActionCommand,
  type CommandExecutionContext, type CommandOutcome, type SettingCommand,
} from './commands'
import type { CommandGraph, CommandNode } from './graph'
import type { SessionRow, SessionSearchResult, SessionSearchState, SessionSettingState } from './sessionStore'

type Execute = (commandId: string, context: CommandExecutionContext) => Promise<CommandOutcome | void> | CommandOutcome | void

const commandRow = (node: CommandNode, trail: boolean, execute: Execute): SessionRow => ({
  id: node.id,
  label: node.title,
  hint: node.hint,
  breadcrumb: trail && node.breadcrumb.length > 1 ? node.breadcrumb.slice(0, -1) : undefined,
  action: isActionCommand(node.command)
    ? { effect: 'run', run: (context) => execute(node.id, context) }
    : { effect: 'enter', commandId: node.id },
})

export const rootRows = (graph: CommandGraph, query: string, execute: Execute): SessionRow[] => {
  const trimmed = query.trim()
  if (!trimmed) return graph.top().map((node) => commandRow(node, false, execute))
  return graph.ranked(trimmed).map((hit) => commandRow(hit.node, true, execute))
}

export const groupRows = (graph: CommandGraph, commandId: string, query: string, execute: Execute): SessionRow[] => {
  const trimmed = query.trim()
  if (!trimmed) return graph.children(commandId).map((node) => commandRow(node, false, execute))
  return graph.ranked(trimmed)
    .filter((hit) => hit.node.parentId === commandId)
    .map((hit) => commandRow(hit.node, false, execute))
}

export const searchRows = (
  state: SessionSearchState,
  select: (result: SessionSearchResult) => Promise<CommandOutcome | void> | CommandOutcome | void,
): SessionRow[] => {
  const failures: SessionRow[] = state.errors.map((error, at) => ({
    id: `error:${error.source}:${at}`,
    label: `${error.source}: ${error.message}`,
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

export const inputRows = (submitting: boolean): SessionRow[] => [{
  id: 'input:hint',
  label: submitting ? 'Submitting…' : 'Press Enter to submit.',
  action: { effect: 'none' },
}]

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
