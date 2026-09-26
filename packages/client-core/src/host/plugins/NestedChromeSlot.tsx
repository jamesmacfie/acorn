import { createContext, useContext, type JSX } from 'solid-js'
import type { SlotRef } from '@acorn/protocol/chrome.ts'
import { ExclusiveSlotFailureContext } from './ExclusiveSlotFailure'

type NestedSlot = { ref: SlotRef; render: () => JSX.Element }
const NestedSlotContext = createContext<readonly NestedSlot[]>()

/** The chrome host lends exactly one named mount to its replacement provider. */
export const mintSlotRef = (): SlotRef => crypto.randomUUID() as SlotRef

export function WithNestedChromeSlots(props: { slots: readonly NestedSlot[]; children: JSX.Element }) {
  return <NestedSlotContext.Provider value={props.slots}>{props.children}</NestedSlotContext.Provider>
}

export function NestedChromeSlot(props: { slotRef: SlotRef }) {
  const slots = useContext(NestedSlotContext)
  const slot = () => slots?.find((entry) => entry.ref === props.slotRef)
  return <NestedSlotContext.Provider value={undefined}>
    <ExclusiveSlotFailureContext.Provider value={undefined}>{slot()?.render()}</ExclusiveSlotFailureContext.Provider>
  </NestedSlotContext.Provider>
}
