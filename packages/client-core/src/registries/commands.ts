import type { ClientCapabilityRequirement } from '../capabilities'
import { hasClientCapability } from '../capabilities'
import { Registry, type Disposable } from './registry'

export type CommandCategory = 'action' | 'navigation' | 'pane' | 'task' | 'terminal' | 'workspace'

export type CommandContribution = {
  id: string
  title: string | (() => string)
  category: CommandCategory
  hint?: string | (() => string | undefined)
  palette?: boolean
  requires?: ClientCapabilityRequirement
  when?: () => boolean
  run: () => void | Promise<void>
}

export const commandRegistry = new Registry<CommandContribution>('command')

export const commandTitle = (command: CommandContribution): string =>
  typeof command.title === 'function' ? command.title() : command.title
export const commandHint = (command: CommandContribution): string | undefined =>
  typeof command.hint === 'function' ? command.hint() : command.hint
export const commandAvailable = (command: CommandContribution): boolean =>
  hasClientCapability(command.requires) && (command.when?.() ?? true)

export function executeCommand(id: string): Promise<void> {
  const command = commandRegistry.get(id)
  if (!command || !commandAvailable(command)) return Promise.resolve()
  return Promise.resolve(command.run())
}

export function registerCommands(commands: readonly CommandContribution[]): Disposable {
  const disposables = commands.map((command) => commandRegistry.register(command))
  return { dispose: () => [...disposables].reverse().forEach((disposable) => disposable.dispose()) }
}
