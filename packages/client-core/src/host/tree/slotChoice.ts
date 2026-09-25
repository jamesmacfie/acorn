import { getOwner, runWithOwner } from 'solid-js'
import { createQuery } from '@tanstack/solid-query'
import { PrefKeys } from '../../infra/persistence/prefKeys'
import { prefsOptions } from '../../infra/queries'
import { slotChoiceFor, slotChoices } from './arbitration'

/**
 * The user's pick for one slot, as the question `resolveSlot` asks when a `replace` tie needs settling.
 *
 * The preferences query is created the first time that question is asked, not when the slot mounts.
 * Only a tie reads the pick, and a tie needs two plugins matching the same key, which is rare. A
 * transcript draws a slot for every tool card, so a query per slot was one query observer, store and
 * `select` pass per card, 452 of them on one long session, all to answer a question nobody asked.
 *
 * Created under the owner of the slot that asked, so it is disposed with that slot.
 */
export function createSlotChoice(point: () => string, key: () => string | undefined): () => string | undefined {
  const owner = getOwner()
  let prefs: { readonly data?: Record<string, string> } | undefined
  return () => {
    prefs ??= runWithOwner(owner, () => createQuery(() => prefsOptions(true)))
    return slotChoiceFor(slotChoices(prefs?.data?.[PrefKeys.remoteSlots]), point(), key())
  }
}
