// Host-facing session summaries. The owning plugins fetch and keep full records.
export { agentSessionsFor, isSettingUp, sessionSummaries, sendToSession, focusSession, refreshSessionSources } from '../../host/registries/sessions/sessionSources'
export type { SessionSummary, SessionSubmit } from '../../host/registries/sessions/sessionSources'
