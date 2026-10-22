// What the account page reads from `GET /v1/p/account/state`, and the plugin's other answers.

export type AccountState = {
  /** This build has an account service to sign in to. */
  configured: boolean
  /** Who is signed in on this Node, or null. */
  account: { id: string; name: string } | null
  remoteAccess: {
    /** This Node is registered with its owner's account and dials a relay. */
    enabled: boolean
    relayUrl?: string
    /** The relay connection is open now, and since when (epoch ms). */
    connected: boolean
    since?: number
    /** Why the switch can't be turned on: another relay is already set for this Node. */
    blocked?: string
  }
}

export type TurnedOff = {
  /** The account service was told. When it wasn't, the Node stays listed until it's removed on the website. */
  accountNotified: boolean
}
