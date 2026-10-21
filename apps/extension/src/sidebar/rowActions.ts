import type { BridgeRequest, BridgeResults } from '@acorn/protocol/extensionBridge.ts'
import { CallFailure } from '../messages'
import type { BridgeClient } from './bridgeClient'

// A data source action on a card's row, which the host checks against a fresh run of the card's plan
// (docs/browser-extension/transcript.md § Row actions). Shared by the panel card and the app card.

type RowActTarget = Extract<BridgeRequest, { op: 'row.act' }>['target']
type RowActResult = BridgeResults['row.act']
type Risk = 'read' | 'write' | 'execute'

// The desktop's words for what an action of each risk can do, as its panel's confirm says them.
const RISK_SAYS: Record<Exclude<Risk, 'read'>, string> = { write: 'change something', execute: 'run something' }

// The confirm for an action that can change or run something. A read action runs without one, as on
// the desktop.
export const actionConfirm = (label: string, rowTitle: string, risk: Risk): string | undefined =>
  risk === 'read' ? undefined : `${label}? ${label} on ${rowTitle}. This can ${RISK_SAYS[risk]}.`

// Sends `row.act`. Each press gets a new key, except a press again after an answer that never came,
// which keeps the key, so the Node acts once however many times the person retries.
export function rowActions(client: BridgeClient, nodeId: string) {
  const viewerZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const uncertain = new Map<string, string>()
  return async (target: RowActTarget, rowId: string, action: { id: string; risk: Risk }): Promise<RowActResult> => {
    const press = JSON.stringify([target, rowId, action.id])
    const key = uncertain.get(press) ?? crypto.randomUUID()
    uncertain.delete(press)
    try {
      return await client.call({
        op: 'row.act',
        nodeId,
        target,
        rowId,
        actionId: action.id,
        confirmedRisk: action.risk,
        viewerZone,
        key,
      })
    } catch (error) {
      if (error instanceof CallFailure && error.code === 'ambiguous_mutation') uncertain.set(press, key)
      throw error
    }
  }
}

// What follows an action that answered `ready`: a web link to open after the link confirm, or
// anything else, which opens in Acorn.
export const nextStep = (result: RowActResult): { url: string } | 'acorn' | undefined => {
  if (result.outcome !== 'ready' || !result.action) return undefined
  const { action } = result
  return action.verb === 'openUrl' && /^https?:\/\//.test(action.url) ? { url: action.url } : 'acorn'
}
