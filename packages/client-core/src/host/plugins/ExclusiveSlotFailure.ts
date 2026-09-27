import { createContext, useContext } from 'solid-js'

/** Only a replacement provider's remote tree receives this host-owned failure report. */
export const ExclusiveSlotFailureContext = createContext<((reason: string) => void) | undefined>()
export const useExclusiveSlotFailure = () => useContext(ExclusiveSlotFailureContext)
