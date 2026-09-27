// The Agents client owns the managed-session store and installs this narrow handoff action when
// active. Hosts can request a return without importing the plugin's private client modules.
let returnHandler: ((sessionId: string) => Promise<void>) | null = null

export function installManagedHandoff(handler: (sessionId: string) => Promise<void>): () => void {
  returnHandler = handler
  return () => { if (returnHandler === handler) returnHandler = null }
}

export function returnToManagedMode(sessionId: string): Promise<void> {
  if (!returnHandler) throw new Error('The Agents plugin is not active on this client.')
  return returnHandler(sessionId)
}
