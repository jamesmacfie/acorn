// The plugin's domain→StatusDot mapping, declared once.
//
// StatusDot takes a semantic tone rather than a domain state, deliberately: the shared layer has no
// business knowing what "reconnecting" means. What it asks in return is that the plugin decide once.
// Before this, the same runtimeState vocabulary was mapped to colours in three separate stylesheets
// (managed-agents.css, agent-center.css twice) with --add-marker/--warn/--del-marker, while docker's
// visually identical dots used --state-ok/warn/bad.

type Tone = 'ok' | 'warn' | 'bad' | 'muted' | 'accent'

/** A managed session's runtime state, as shown in the pane header, task sidebar and Agent Center. */
export const runtimeTone = (state: string): Tone => {
  if (state === 'ready') return 'ok'
  if (state === 'working' || state === 'connecting' || state === 'reconnecting') return 'accent'
  if (state === 'waiting') return 'warn'
  if (state === 'failed') return 'bad'
  return 'muted'
}

/* A tool call's dot is NOT here: its status is a protocol type and the changes plugin renders it
   too, so `agentToolTone` lives beside the renderer contract in client-core. */

/** A provider's install/auth health in the Agent Center header. */
export const providerTone = (health: 'ok' | 'error' | 'missing'): Tone => {
  if (health === 'ok') return 'ok'
  // Authentication required is recoverable, so it is a warning rather than a failure — which is what
  // the old CSS said too (--warn), despite the state being named 'error'.
  if (health === 'error') return 'warn'
  return 'muted'
}

/** Plan-usage health, a separate vocabulary from provider health. */
export const usageTone = (health: string): Tone => {
  if (health === 'healthy') return 'ok'
  if (health === 'warning') return 'warn'
  if (health === 'critical') return 'bad'
  return 'muted'
}
