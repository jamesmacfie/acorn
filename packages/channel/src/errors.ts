// What goes wrong on a channel, as errors a caller can tell apart. They sit apart from the code that opens
// a channel, so whatever only has to recognise one doesn't load the handshake's libraries with it.

/** A request the Node couldn't answer at all, as against one it answered with an error status. */
export class ChannelFailure extends Error {
  constructor(
    readonly code: 'bad_request' | 'response_too_large' | 'unreachable' | 'closed',
    message: string,
  ) {
    super(message)
  }
}

/** The Node on the other end isn't the one pinned. Retrying can't fix it, and the phone must not go on. */
export class IdentityMismatchError extends Error {
  constructor(options?: ErrorOptions) {
    super('The Node answered with a different identity than the one this phone pinned.', options)
    this.name = 'IdentityMismatchError'
  }
}
