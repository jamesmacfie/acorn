import type { PluginTelemetry, SpanHandle } from '@acorn/plugin-api/node'
import type { AgentSession } from '../../contract/wire'
import type { AgentStartupPhase, MeasureAgentStartup } from '../drivers/startupTelemetry'

/** One bounded startup, with preparation and provider phases in the same trace.
 *  See docs/managed-agents/session-events.md § What a session reports. */
export function sessionStartupTelemetry(
  telemetry: Pick<PluginTelemetry, 'enabled' | 'startSpan'> | undefined,
  session: AgentSession,
  reconnect: boolean,
  signal: AbortSignal,
) {
  if (!telemetry?.enabled()) return undefined
  const attrs = { 'session.id': session.id, 'task.id': session.taskId, provider: session.providerId, reconnect }
  const total = telemetry.startSpan('agent.session.start', { attrs: { ...attrs, seam: 'agent.session.start' } })
  const measure = async <T>(
    name: 'agent.session' | 'agent.session.phase',
    phase: AgentStartupPhase | undefined,
    parent: SpanHandle,
    run: (span: SpanHandle) => Promise<T>,
  ): Promise<T> => {
    const span = telemetry.startSpan(name, {
      traceId: parent.traceId,
      parentSpanId: parent.spanId,
      attrs: { ...attrs, seam: name, ...(phase ? { phase } : {}) },
    })
    const cancelled = () => span.end('error', { outcome: 'cancelled' })
    signal.addEventListener('abort', cancelled, { once: true })
    if (signal.aborted) cancelled()
    try {
      const value = await run(span)
      span.end('ok', { outcome: 'ready' })
      return value
    } catch (error) {
      span.end('error', { outcome: signal.aborted ? 'cancelled' : 'error' })
      throw error
    } finally {
      signal.removeEventListener('abort', cancelled)
    }
  }
  const phases = (parent: SpanHandle): MeasureAgentStartup =>
    (phase, run) => measure('agent.session.phase', phase, parent, run)
  return {
    phase: phases(total),
    provider: <T>(run: (phase: MeasureAgentStartup) => Promise<T>): Promise<T> =>
      measure('agent.session', undefined, total, (span) => run(phases(span))),
    end: (status: 'ok' | 'error') => total.end(status, {
      outcome: signal.aborted ? 'cancelled' : status === 'ok' ? 'ready' : 'error',
    }),
  }
}
