/** Fixed startup stages. Protocol payloads and user configuration never become labels. */
export type AgentStartupPhase =
  | 'task.root' | 'workspace.read' | 'history.read' | 'mcp.prepare'
  | 'driver.load' | 'provider.probe' | 'provider.initialize'
  | 'provider.session.create' | 'provider.session.resume' | 'provider.session.load'
  | 'provider.models' | 'provider.permissions' | 'provider.skills' | 'provider.modes'
  | 'provider.metadata' | 'provider.ready'

export type MeasureAgentStartup = <T>(phase: AgentStartupPhase, run: () => Promise<T>) => Promise<T>

export function measureAgentStartup<T>(
  options: { measureStartup?: MeasureAgentStartup },
  phase: AgentStartupPhase,
  run: () => Promise<T>,
): Promise<T> {
  return options.measureStartup ? options.measureStartup(phase, run) : run()
}
