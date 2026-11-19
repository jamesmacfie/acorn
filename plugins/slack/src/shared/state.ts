// What Settings → Slack reads from `GET /v1/p/slack/state`.

type SlackLinkState = {
  teamId: string
  teamName: string
  slackUserName: string
  /** This Node takes the link's Slack work. Otherwise `nodeLabel` names the Node that does. */
  here: boolean
  nodeLabel?: string
  /** The owner answers approvals from Slack. Only known for a link to this Node. */
  approvals: boolean
}

export type SlackState = {
  /** Someone is signed in to the account service on this Node. */
  signedIn: boolean
  /** Remote access is on, which is how the gateway reaches this Node. */
  remoteAccess: boolean
  links: SlackLinkState[]
  /** The gateway didn't answer, with why. */
  error?: string
}
