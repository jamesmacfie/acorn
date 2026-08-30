import type { Duplex } from 'node:stream'

// Which upgrade handler owns a socket.
//
// Node destroys an upgraded socket only while no 'upgrade' listener exists. Add one and that default
// is gone, so an upgrade to a path neither of our path-scoped listeners owns is answered by nobody:
// the socket stays open for the life of the process, and `server.close()` hangs, because an upgraded
// socket is no longer in the list `closeAllConnections` reaps.
//
// A handler claims a socket synchronously, before any await, so a later listener can tell "mine"
// from "not answered yet". The listener registered last destroys whatever nobody claimed.
const CLAIMED = Symbol.for('acorn.upgradeClaimed')

type Claimable = Duplex & { [CLAIMED]?: true }

export const claimUpgrade = (socket: Duplex): void => void ((socket as Claimable)[CLAIMED] = true)

export const isUpgradeClaimed = (socket: Duplex): boolean => (socket as Claimable)[CLAIMED] === true
