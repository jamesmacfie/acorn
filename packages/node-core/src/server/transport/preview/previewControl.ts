// What the rest of the Node may ask of its previews. Types only, so a route that opens one loads nothing
// of the certificate or the server until a Node with Remote access on has them.

export type PreviewRequest = {
  /** The paired device that is opening it, whose revocation ends the preview. */
  deviceId: string | undefined
  /** The origin that will frame the page, or undefined for a page of its own. */
  ancestor: string | undefined
  /** The dev server's port on this computer, asked for again on each request. */
  port(): Promise<number | null>
}

// `off`: this Node has no Remote access or no account service. `unsupported`: the service has no preview
// domain. `starting`: no certificate yet. `expired`: it ran out and couldn't be renewed.
export type PreviewUnavailable = 'off' | 'unsupported' | 'starting' | 'expired'
export type PreviewOpened = { url: string } | { unavailable: PreviewUnavailable }

export type PreviewControl = { open(request: PreviewRequest): PreviewOpened }
