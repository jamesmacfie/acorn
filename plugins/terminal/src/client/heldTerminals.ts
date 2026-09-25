// The terminals a reader has open, held past the drawer that drew them (docs/terminal.md § Client).
//
// A tab's xterm lives from the first frame it is shown until its session leaves the roster: the tab
// closed, the session removed or killed from anywhere, its task archived, or the node switched. The
// drawer's open state is per task, so a switch to a task without it open unmounts the whole panel, and
// anything the panel owned would go with it. This map is what outlives the panel.
//
// No xterm in this file. The session store reads the roster at startup and prunes through here, and
// xterm is a lazy chunk that only a drawn surface loads (./liveXterm.ts).
export type HeldTerminal = {
  readonly nodeId: string
  readonly sessionId: string
  /** A surface is drawing it this moment. A mounted terminal is its surface's to let go of. */
  readonly mounted: boolean
  dispose(): void
}

const held = new Map<string, HeldTerminal>()
const key = (nodeId: string, sessionId: string): string => `${nodeId}\n${sessionId}`

export function holdTerminal<T extends HeldTerminal>(nodeId: string, sessionId: string, build: () => T): T {
  const existing = held.get(key(nodeId, sessionId))
  if (existing) return existing as T
  const terminal = build()
  held.set(key(nodeId, sessionId), terminal)
  return terminal
}

/**
 * Called with a roster the node answered with, after the drawer has drawn it. A terminal whose
 * session the node no longer lists goes, unless a surface still draws it: that is a read which set
 * out before the session was created, and the next read settles it. A failed read never gets here,
 * so a network blip keeps every terminal.
 */
export function releaseGoneTerminals(nodeId: string, sessionIds: readonly string[]): void {
  const listed = new Set(sessionIds)
  for (const [id, terminal] of held) {
    if (terminal.nodeId !== nodeId || terminal.mounted || listed.has(terminal.sessionId)) continue
    held.delete(id)
    terminal.dispose()
  }
}

/** A node switch. The attachments went with the old node (./wsChannel.ts), so the xterms go too. */
export function releaseAllTerminals(): void {
  const all = [...held.values()]
  held.clear()
  for (const terminal of all) terminal.dispose()
}

export const heldTerminalCount = (): number => held.size
