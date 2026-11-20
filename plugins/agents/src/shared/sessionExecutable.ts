import type { AgentExecutable, AgentProviderDescriptor, AgentSession } from '../contract/wire.ts'

/** Absent on sessions recorded before executable metadata was available. */
export function sessionExecutable(session: AgentSession): AgentExecutable | undefined {
  const value = session.config.executable
  if (!value || typeof value !== 'object' || !('path' in value) || typeof value.path !== 'string') return undefined
  return {
    path: value.path,
    version: 'version' in value && typeof value.version === 'string' ? value.version : undefined,
  }
}

export function sessionExecutableChanged(
  session: AgentSession,
  provider: AgentProviderDescriptor | undefined,
): boolean {
  if (session.controller !== 'acorn' || !['ready', 'working', 'waiting'].includes(session.runtimeState)) return false
  const executable = sessionExecutable(session)
  if (!executable || !provider?.executable) return false
  return (
    executable.path !== provider.executable ||
    (!!executable.version && !!provider.executableVersion && executable.version !== provider.executableVersion)
  )
}
