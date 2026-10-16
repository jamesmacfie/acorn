import { readJson, writeJson } from '@acorn/plugin-api/client'
import {
  agentMcpServerRoute,
  agentMcpServersRoute,
  agentMcpServerTestRoute,
  agentMcpPackagePlanRoute,
  agentMcpPackageActivateRoute,
  agentMcpPackageTestRoute,
  agentMcpServerConsentRoute,
  agentMcpReviewsRoute,
  agentMcpReviewRoute,
  agentMcpSignInAttemptRoute,
  agentMcpSignInFinishRoute,
  agentMcpSignInRoute,
  agentMcpSignOutRoute,
  type AgentMcpPendingReview,
  type AgentMcpPackagePlan,
  type AgentMcpPackageTest,
  type AgentMcpProbeResult,
  type AgentMcpServer,
  type AgentMcpServerInput,
  type AgentMcpSignInFinish,
  type AgentMcpSignInStarted,
} from '../../shared/mcpServers'

export const agentMcpServersQueryKey = ['agents', 'mcp-servers'] as const

export const agentMcpServersOptions = () => ({
  queryKey: agentMcpServersQueryKey,
  queryFn: ({ signal }: { signal?: AbortSignal }) => readJson<AgentMcpServer[]>(agentMcpServersRoute, { signal }),
})

export const saveAgentMcpServer = (name: string, input: AgentMcpServerInput) =>
  writeJson<AgentMcpServer>(
    agentMcpServerRoute(name),
    { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) },
    (response) => `MCP server save ${response.status}`,
  )

export const removeAgentMcpServer = (name: string) =>
  writeJson<{ ok: true }>(
    agentMcpServerRoute(name),
    { method: 'DELETE' },
    (response) => `MCP server remove ${response.status}`,
  )

// The node gives a server 30 seconds to answer, which is the broker's own default, so the request
// waits a little longer than that to hear the node's answer rather than the broker's.
export const testAgentMcpServer = (name: string) =>
  writeJson<AgentMcpProbeResult>(
    agentMcpServerTestRoute(name),
    { method: 'POST', timeoutMs: 45_000 },
    (response) => `MCP server test ${response.status}`,
  )

export const planAgentMcpPackage = (
  coordinate: string,
  targetName: string,
  expectedRevision: string | null,
  exceptions: Array<{ coordinate: string; reason: string }> = [],
) =>
  writeJson<AgentMcpPackagePlan>(
    agentMcpPackagePlanRoute,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ coordinate, targetName, expectedRevision, exceptions }),
      timeoutMs: 150_000,
    },
    (response) => `MCP package plan ${response.status}`,
  )

export const testAgentMcpPackagePlan = (name: string, planId: string, bin: string) =>
  writeJson<AgentMcpPackageTest>(
    agentMcpPackageTestRoute(planId),
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, bin }),
      timeoutMs: 75_000,
    },
    (response) => `MCP package test ${response.status}`,
  )

export const activateAgentMcpPackage = (name: string, planId: string, bin: string, updating: AgentMcpServer | null) =>
  writeJson<AgentMcpServer>(
    agentMcpPackageActivateRoute(name),
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ planId, bin, enabled: updating?.enabled ?? true }),
      timeoutMs: 45_000,
    },
    (response) => `MCP package activation ${response.status}`,
  )

export const consentAgentMcpServer = (name: string, revision: string) =>
  writeJson<AgentMcpServer>(
    agentMcpServerConsentRoute(name),
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ revision }) },
    (response) => `MCP server consent ${response.status}`,
  )

export const pendingAgentMcpReviews = () => readJson<AgentMcpPendingReview[]>(agentMcpReviewsRoute)

export const approveAgentMcpReview = (review: AgentMcpPendingReview) =>
  writeJson<AgentMcpServer>(
    agentMcpReviewRoute(review.name),
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: review.sessionId, revision: review.revision, digest: review.digest }),
      timeoutMs: 45_000,
    },
    (response) => `MCP catalogue approval ${response.status}`,
  )

// Sign-in (docs/mcp/sign-in.md). Starting runs discovery and may register a client,
// and finishing exchanges the code, each a round trip to the server's sign-in host from the node.
export const startAgentMcpSignIn = (name: string, redirectUri: string) =>
  writeJson<AgentMcpSignInStarted>(
    agentMcpSignInRoute(name),
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ redirectUri }),
      timeoutMs: 45_000,
    },
    (response) => `MCP sign-in ${response.status}`,
  )

export const finishAgentMcpSignIn = (name: string, attemptId: string, input: AgentMcpSignInFinish) =>
  writeJson<AgentMcpServer>(
    agentMcpSignInFinishRoute(name, attemptId),
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input), timeoutMs: 45_000 },
    (response) => `MCP sign-in ${response.status}`,
  )

export const cancelAgentMcpSignIn = (name: string, attemptId: string) =>
  writeJson<{ ok: true }>(
    agentMcpSignInAttemptRoute(name, attemptId),
    { method: 'DELETE' },
    (response) => `MCP sign-in cancel ${response.status}`,
  )

export const signOutAgentMcpServer = (name: string) =>
  writeJson<AgentMcpServer>(
    agentMcpSignOutRoute(name),
    { method: 'POST', timeoutMs: 30_000 },
    (response) => `MCP sign-out ${response.status}`,
  )
