// Only the socket's peer address is an authentication input. Host, Forwarded, and
// X-Forwarded-For describe a destination or caller-controlled metadata, not the peer.
export function isLoopbackPeer(address: string | undefined): boolean {
  return address === '::1' || address === '127.0.0.1' || address === '::ffff:127.0.0.1'
}
