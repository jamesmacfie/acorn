// The node's connection state, in the two forms the chrome draws it: a dot on the topbar and a
// sentence on the footer.
//
// One table for both, because a dot that says "something is wrong" and a footer that says nothing is
// worse than either alone. `revoked` never retries, so its sentence says what to do rather than what
// happened — the one state a person has to act on.

import type { NodeConnectionState } from '@acorn/protocol/broker.ts'
import type { Tone } from '@acorn/client-core/kit/tokens/tokens.ts'

type DotTone = Extract<Tone, 'ok' | 'warn' | 'danger' | 'muted' | 'accent'>

const TONES: Record<NodeConnectionState, DotTone> = {
  online: 'ok',
  degraded: 'warn',
  offline: 'danger',
  incompatible: 'danger',
  revoked: 'danger',
}

const SENTENCES: Partial<Record<NodeConnectionState, string>> = {
  degraded: 'reconnecting to the node…',
  offline: 'the node is unreachable — retrying',
  incompatible: 'this node speaks a different protocol version — upgrade whichever is older',
  revoked: 'this device was revoked on the node — pair again to come back',
}

export const nodeTone = (state: NodeConnectionState): DotTone => TONES[state] ?? 'muted'

/** What the footer says, or nothing at all while the node is fine. */
export const nodeSentence = (state: NodeConnectionState): string | undefined => SENTENCES[state]
