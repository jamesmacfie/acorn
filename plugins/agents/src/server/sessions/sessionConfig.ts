// `agents.sessionControl` `setConfig` (docs/managed-agents/session-control.md). Its caller has checked
// the session belongs to the task.
import type { AgentConfigOption, AgentSession } from '../../contract/wire.ts'
import type { ControlRuntime } from './sessionControl'

export async function setSessionConfig(
  runtime: Pick<ControlRuntime, 'patchSession'>,
  session: AgentSession,
  optionId: string,
  value: string,
  caller: string | undefined,
): Promise<void> {
  if (session.archivedAt) throw new Error('Archived sessions cannot change options.')
  if (session.controller !== 'acorn') throw new Error(`Session input is controlled by ${session.controller}.`)
  const options = Array.isArray(session.config.configOptions) ? session.config.configOptions as AgentConfigOption[] : []
  const option = options.find((candidate) => candidate.id === optionId)
  if (!option) throw new Error(`The harness did not advertise option '${optionId}'.`)
  // Stricter than the picker's path, which accepts any value for an option that lists none.
  if (!option.values?.some((candidate) => candidate.value === value)) {
    throw new Error(`The harness did not advertise value '${value}' for '${optionId}'.`)
  }
  if (option.currentValue === value) return
  // The picker's own patch, so the provider, the saved config, and every client's picker agree. A
  // plugin's change isn't the person's choice, so it doesn't become their default.
  await runtime.patchSession(session.id, {
    config: { ...session.config, configOptions: options.map((item) => item.id === optionId ? { ...item, currentValue: value } : item) },
  }, { remember: false, ...(caller ? { changedBy: caller } : {}) })
}
