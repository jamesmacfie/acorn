const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

// The port a task's preview address names on this Node's own loopback, or null for any other address.
// Only plain `http` on a loopback name qualifies: the proxy connects to the loopback it is given a port for,
// so an address that names another host, or a TLS site, has nothing to proxy.
export function loopbackPort(address: string | null | undefined): number | null {
  if (!address || !URL.canParse(address)) return null
  const url = new URL(address)
  if (url.protocol !== 'http:' || !LOOPBACK_HOSTS.has(url.hostname)) return null
  return Number(url.port || 80)
}
