// How a managed session's runtime state looks: the same shape and colour on the desktop and in the
// browser extension.

import type { RailMarker } from '@acorn/plugin-api/client'

type Tone = 'ok' | 'muted' | 'accent' | 'warn' | 'danger'

/** A managed session's runtime state, as shown in the pane header, task sidebar, Agent Center, the
 *  sessions dashboard panel, and the extension's agent rows.
 *
 *  A finished session is muted rather than green. Most rows in a busy task are finished, so colouring
 *  all of them buries the one that is running or needs an answer. Green is reserved for work in
 *  flight, which is the row worth finding. */
export const runtimeTone = (state: string): Tone => {
  if (state === 'working') return 'ok'
  if (state === 'creating' || state === 'connecting' || state === 'replaying' || state === 'reconnecting') {
    return 'accent'
  }
  if (state === 'waiting' || state === 'cancelling' || state === 'stopped') return 'warn'
  if (state === 'failed') return 'danger'
  return 'muted'
}

/** The icon for a runtime state, beside the tone above, because the two are one decision: a shape
 *  and a colour saying the same thing. Host icon names (docs/ui-design/icons.md § Icons), so both the
 *  sidebar's own markup and the dashboard panel's enum values draw from this one map. */
const RUNTIME_ICON: Record<string, string> = {
  creating: 'clock',
  connecting: 'clock',
  replaying: 'clock',
  // `ready` is where a session rests once its turn is over, so the resting mark says finished rather
  // than drawing the blank circle a never-run session would deserve. Muted, not green, for the reason
  // above: most rows in a busy task are finished.
  ready: 'circle-check',
  working: 'loader-circle',
  waiting: 'circle-alert',
  cancelling: 'loader-circle',
  reconnecting: 'loader-circle',
  stopped: 'circle-stop',
  failed: 'triangle-alert',
  archived: 'archive',
}

export const runtimeIcon = (state: string): string => RUNTIME_ICON[state] ?? 'circle-dashed'

export type AgentRailState = { working: number; attention: number }

/** The marker for one task's agent state, or nothing to say, on the desktop's rails and the extension's
 *  Agents tab. Each counts its own sessions. Attention wins outright rather than taking a second corner:
 *  one row, one answer to "what is this task's agent doing", and "it needs you" is the answer that
 *  matters. */
export function agentRailMarkers({ working, attention }: AgentRailState): RailMarker[] {
  if (attention)
    return [
      {
        id: 'attention',
        label: `${attention} agent${attention > 1 ? 's' : ''} need${attention > 1 ? '' : 's'} you`,
        // The same shape the pane header, the task sidebar and Agent Center give these two states
        // (`runtimeIcon`), so a reader learns one vocabulary.
        icon: runtimeIcon('waiting'),
        tone: 'warn',
        placements: ['top-end'],
      },
    ]
  if (working)
    return [
      {
        id: 'working',
        label: `${working} agent${working > 1 ? 's' : ''} working`,
        icon: runtimeIcon('working'),
        tone: 'accent',
        busy: true,
        placements: ['top-end'],
      },
    ]
  return []
}
