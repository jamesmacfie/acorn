import { createContext, useContext } from 'solid-js'

/** A directly mounted pane lets shared kit layouts name their focus regions. */
export const PaneIdContext = createContext<string>()
export const paneIdForFocus = (): string | undefined => useContext(PaneIdContext)
