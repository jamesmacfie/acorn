import type { QueryClient } from '@tanstack/solid-query'
import { PrefKeys } from '../../infra/persistence/prefKeys'
import { activeNodeId } from '../../infra/node/activeNode'
import { nodePrefsKey } from '../../infra/queries'
import { pushBackgroundError } from '../notifications/notifications'
import { failuresThrown, savePref, setPref } from './savePref'

// The one telemetry switch, as a reader and a writer (docs/telemetry/model.md § The switch).
//
// Two places read it, so it is a function rather than an inline `prefs?.[key] === '1'` in each: the
// Settings page draws it, and `App.tsx` turns the client's emitter on and off with it. The same rule
// `./appearancePrefs.ts` states, that a setting a person can change from two places has one accessor.
//
// A node preference and not a device one. The collector runs on the node and re-reads this row every
// five seconds, so turning it off in one window stops every client paired with that node, which is
// what "nothing leaves this machine that you did not agree to" has to mean.

/** Off unless the row says `'1'`, which is the same reading the node's collector does. */
export const telemetryOn = (prefs: Record<string, string> | undefined): boolean => prefs?.[PrefKeys.telemetry] === '1'

/** Write the switch on one node. The active node's row goes through the shared writer, so the cache
 *  every reader shares moves with it, `App.tsx`'s emitter included. Another node's row is written to
 *  that node directly, since nothing in this window reads it but the page that asked. */
export async function saveTelemetryOn(qc: QueryClient, on: boolean, nodeId: string | null): Promise<boolean> {
  const value = on ? '1' : '0'
  const throwing = failuresThrown()
  try {
    if (!nodeId || nodeId === activeNodeId()) return await savePref(qc, PrefKeys.telemetry, value)
    await setPref(PrefKeys.telemetry, value, nodeId)
    return true
  } catch (error) {
    if (throwing) throw error
    pushBackgroundError('', `Could not save ${PrefKeys.telemetry}`, error instanceof Error ? error.message : String(error))
    return false
  } finally {
    await qc.invalidateQueries({ queryKey: nodePrefsKey(nodeId) })
  }
}
