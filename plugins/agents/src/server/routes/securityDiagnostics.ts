import { Hono } from 'hono'
import { type AppEnv, requireDevice, respondError, routeCapability, setRouteTestCapability, viaBridge } from '@acorn/plugin-api/node'
import type { SecurityDiagnostics, SecurityScope, SecurityScopeChoices } from '../../shared/securityDiagnostics'

export type AgentSecurityDiagnosticsBridge = {
  check(nodeId: string, userId: string, scope: SecurityScope, signal: AbortSignal): Promise<SecurityDiagnostics>
  scopes(): Promise<SecurityScopeChoices>
}
export const AGENT_SECURITY_DIAGNOSTICS = routeCapability<AgentSecurityDiagnosticsBridge>('agents.securityDiagnosticsRoute')
export const setAgentSecurityDiagnosticsBridge = (bridge: AgentSecurityDiagnosticsBridge | null): void =>
  setRouteTestCapability(AGENT_SECURITY_DIAGNOSTICS, bridge)

const validId = (value: string | undefined): value is string =>
  typeof value === 'string' && value.length > 0 && value.length < 200 && /^[A-Za-z0-9_-]+$/.test(value)

export const agentSecurityDiagnostics = new Hono<AppEnv>()
  .get('/security-diagnostics/scopes', requireDevice, (c) => viaBridge(c, AGENT_SECURITY_DIAGNOSTICS, (bridge) => bridge.scopes()))
  .get('/security-diagnostics', requireDevice, (c) => {
    const projectId = c.req.query('projectId')
    if (projectId && !validId(projectId)) return respondError(c, 400, 'bad_request', ['Invalid diagnostic scope.'])
    const scope: SecurityScope = projectId ? { projectId } : {}
    return viaBridge(c, AGENT_SECURITY_DIAGNOSTICS, (bridge) =>
      bridge.check(c.env.NODE_ID, c.get('principal')!.userId, scope, c.req.raw.signal))
  })
