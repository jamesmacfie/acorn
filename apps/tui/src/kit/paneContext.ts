import { createContext, useContext } from 'solid-js'

/** A directly mounted pane lets shared kit layouts name their focus regions. */
export const PaneIdContext = createContext<string>()
export const paneIdForFocus = (): string | undefined => useContext(PaneIdContext)

/** What a link with only an address asks the pane it sits in for: the host's link menu, bound to that
 *  pane's task. Outside a pane there is no menu and the link prints its address, as it always has. */
export type LinkMenu = (link: { url: string; label?: string; showAddress: () => void }) => void
export const LinkMenuContext = createContext<LinkMenu>()
