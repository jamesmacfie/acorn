/** A transport's answer to a response that would exceed the limit it was given. The cache turns it into
 *  `too-large`, whichever host's transport threw it. */
export class NodeResponseTooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super(`The node response exceeds the ${maxBytes} byte limit.`)
    this.name = 'NodeResponseTooLargeError'
  }
}
