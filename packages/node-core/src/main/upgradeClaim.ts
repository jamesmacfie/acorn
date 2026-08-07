import type { Duplex } from 'node:stream'

// Which upgrade handler owns a socket.
//
// Node's default for an HTTP upgrade with NO 'upgrade' listener is to destroy the socket. As soon as one
// listener exists that default is gone, and it becomes every listener's job — but both of ours are
// path-scoped and correctly ignore a path they do not own, so an upgrade to `/anything-else` was answered
// by nobody and the connection stayed open for the lifetime of the process. One `curl` per socket, unbounded.
// It also made `server.close()` hang, because an upgraded socket is no longer in the server's connection
// list for `closeAllConnections` to reap.
//
// So a handler CLAIMS a socket synchronously — before any await, which matters because auth is async and a
// later listener must be able to tell "mine" from "not answered yet" — and the listener registered last
// destroys whatever nobody claimed.
const CLAIMED = Symbol.for('acorn.upgradeClaimed')

type Claimable = Duplex & { [CLAIMED]?: true }

export const claimUpgrade = (socket: Duplex): void => void ((socket as Claimable)[CLAIMED] = true)

export const isUpgradeClaimed = (socket: Duplex): boolean => (socket as Claimable)[CLAIMED] === true
