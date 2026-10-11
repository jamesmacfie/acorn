// Host-facing session summaries. The owning plugins fetch and keep full records.
export {
  agentSessionsFor,
  sessionSummaries,
  sendToSession,
  refreshSessionSources,
} from '../../host/registries/sessions/sessionSources'
export type { SessionSummary } from '../../host/registries/sessions/sessionSources'
