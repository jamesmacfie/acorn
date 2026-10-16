// What the Settings → MCP servers routes ask of the runtime. Its own module, so the plugin's entrypoint
// can provide the bridge at boot while the routes load on their first request.
import { routeCapability, setRouteTestCapability } from '@acorn/plugin-api/node'
import type {
  AgentMcpProbeResult,
  AgentMcpServer,
  AgentMcpServerInput,
  AgentMcpPackagePlan,
  AgentMcpPackageTest,
  AgentMcpPendingReview,
  AgentMcpSignInFinish,
  AgentMcpSignInStarted,
} from '../../shared/mcpServers'

export type AgentMcpServersBridge = {
  list(): Promise<AgentMcpServer[]>
  save(name: string, input: AgentMcpServerInput): Promise<AgentMcpServer>
  remove(name: string): Promise<boolean>
  test(name: string): Promise<AgentMcpProbeResult | null>
  consent(name: string, revision: string): Promise<AgentMcpServer | null>
  planPackage(
    coordinate: string,
    targetName: string,
    expectedRevision: string | null,
    exceptions: Array<{ coordinate: string; reason: string }>,
    signal: AbortSignal,
  ): Promise<AgentMcpPackagePlan>
  testPackagePlan(name: string, planId: string, bin: string, signal: AbortSignal): Promise<AgentMcpPackageTest>
  activatePackage(
    name: string,
    planId: string,
    bin: string,
    enabled: boolean,
    signal: AbortSignal,
  ): Promise<AgentMcpServer>
  pendingReviews(): Promise<AgentMcpPendingReview[]>
  approveReview(name: string, sessionId: string, revision: string, digest: string): Promise<AgentMcpServer>
  startSignIn(name: string, redirectUri: string, deviceId: string): Promise<AgentMcpSignInStarted>
  finishSignIn(
    name: string,
    attemptId: string,
    deviceId: string,
    input: AgentMcpSignInFinish,
  ): Promise<AgentMcpServer | null>
  cancelSignIn(name: string, attemptId: string, deviceId: string): Promise<boolean>
  signOut(name: string): Promise<AgentMcpServer | null>
}

export const AGENT_MCP_SERVERS = routeCapability<AgentMcpServersBridge>('agents.mcpServersRoute')
/** @internal test compatibility; production providers use CapabilityRegistry.provide. */
export const setAgentMcpServersBridge = (bridge: AgentMcpServersBridge | null): void =>
  setRouteTestCapability(AGENT_MCP_SERVERS, bridge)
