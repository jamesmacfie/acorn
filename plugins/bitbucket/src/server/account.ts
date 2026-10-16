// Which Bitbucket connection this Node has, held in memory and read again at init and whenever a
// Bitbucket connection changes. There is at most one. The mirror is keyed by it, so when it goes or is
// replaced by another account, the rows of every other connection are dropped.

export type BitbucketAccount = {
  /** The connection the mirror and every call use, or null when Bitbucket isn't connected. */
  connectionId(): string | null
  /** Read the connections again, and forget the mirror rows of any that are gone. Runs one at a time. */
  sync(): Promise<void>
}

export function createBitbucketAccount(deps: {
  connections(): Promise<{ id: string }[]>
  /** Drop mirror rows of every connection not named. */
  forgetOthers(connectionIds: string[]): Promise<void>
}): BitbucketAccount {
  let current: string | null = null
  let running: Promise<void> = Promise.resolve()

  const sync = async (): Promise<void> => {
    const connections = await deps.connections()
    // A Node that has never had a Bitbucket connection has no mirror rows, and skipping the purge keeps
    // it from loading the mirror at boot.
    const purge = connections.length > 0 || current !== null
    current = connections[0]?.id ?? null
    if (purge) await deps.forgetOthers(connections.map((connection) => connection.id))
  }

  return {
    connectionId: () => current,
    sync: () => (running = running.catch(() => undefined).then(sync)),
  }
}
