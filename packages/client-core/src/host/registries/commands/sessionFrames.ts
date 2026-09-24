import { DEFAULT_COMMAND_SEARCH_MIN_QUERY } from '@acorn/protocol/commands.ts'
import type { CommandContribution, SearchCommand } from './commands'
import type { CommandNode } from './graph'
import type { SessionFrame, SessionFrameKind, SessionSearchState, SessionSettingState } from './sessionStore'

export const ROOT: SessionFrame = {
  kind: 'root', commandId: null, title: null, breadcrumb: [], query: '', selectedId: null, status: '', placeholder: '',
}

const frameKind = (command: CommandContribution): SessionFrameKind =>
  command.kind === 'search' || command.kind === 'input' || command.kind === 'setting' ? command.kind : 'group'

export const minQueryOf = (command: SearchCommand): number =>
  Math.max(0, command.minQueryLength ?? DEFAULT_COMMAND_SEARCH_MIN_QUERY)

export const instructionState = (command: SearchCommand): SessionSearchState => {
  const minimum = minQueryOf(command)
  return {
    phase: 'instruction',
    message: minimum > 0 ? `Type at least ${minimum} characters to search.` : '',
    results: [],
    errors: [],
  }
}

export const SETTING_LOADING: SessionSettingState = { phase: 'loading', message: 'Loading\u2026', value: null }

export const frameFor = (node: CommandNode): SessionFrame => ({
  kind: frameKind(node.command),
  commandId: node.id,
  title: node.title,
  breadcrumb: node.breadcrumb,
  query: '',
  selectedId: null,
  status: '',
  placeholder: node.command.kind === 'setting'
    ? 'Filter the choices…'
    : (node.command.kind === 'search' || node.command.kind === 'input' ? node.command.placeholder : '') ?? '',
  ...(node.command.kind === 'search' ? { search: instructionState(node.command) } : {}),
  ...(node.command.kind === 'setting' ? { setting: SETTING_LOADING } : {}),
})
