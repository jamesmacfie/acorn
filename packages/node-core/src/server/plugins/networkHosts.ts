/** An exact hostname, one subdomain label under `*.domain`, or the explicit any-host grant. */
export function networkHostAllowed(hostname: string, grants: ReadonlySet<string>): boolean {
  if (grants.has('*') || grants.has(hostname)) return true
  const firstDot = hostname.indexOf('.')
  return firstDot > 0 && grants.has(`*.${hostname.slice(firstDot + 1)}`)
}
