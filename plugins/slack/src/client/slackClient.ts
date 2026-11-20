// The Slack plugin's settings routes, called on the Node whose settings are open.
import { activeNodeId, readJson, writeJson } from '@acorn/plugin-api/client'
import { slackRoute } from '../contract/routes'
import type { SlackState } from '../shared/state'

const send = <T>(path: string, method: string, body: unknown): Promise<T> =>
  writeJson<T>(slackRoute(path), {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

export const fetchSlackState = (nodeId: string | null = activeNodeId()): Promise<SlackState> =>
  readJson<SlackState>(slackRoute('/state'), { nodeId })
export const startLink = () => send<{ url: string; expiresAt: number }>('/link', 'POST', {})
export const confirmLink = (teamId: string, slackUserId: string, approvals: boolean) =>
  send<{ ok: true }>('/confirm', 'POST', { teamId, slackUserId, approvals })
export const unlink = (teamId: string) => send<{ ok: true }>('/unlink', 'POST', { teamId })
export const setApprovals = (teamId: string, enabled: boolean) =>
  send<{ ok: true }>('/approvals', 'PUT', { teamId, enabled })
export const fetchSharedTo = (sessionId: string) =>
  readJson<{ sharedTo: string | null }>(slackRoute(`/sessions/${encodeURIComponent(sessionId)}`))
