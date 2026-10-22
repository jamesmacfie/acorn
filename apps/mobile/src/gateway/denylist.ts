// The Node routes a phone can't reach through the gateway. The gateway's device has owner power, and
// these are the families the phone has no screen for. The last two also trust a loopback caller to be
// someone at the Node's computer, which the gateway would make every phone.
//
// A test pins this list, so a new family is a reviewed change.
export const DENIED_ROUTES: readonly { family: string; methods?: readonly string[]; path: RegExp }[] = [
  { family: 'Pairing and devices', path: /^\/v1\/(core\/)?(pair|devices)(\/|$)/ },
  // Every plugin write, so a write route added later is refused too. Reads stay open for the roster.
  { family: 'Plugin settings', methods: ['POST', 'PUT', 'PATCH', 'DELETE'], path: /^\/v1\/core\/plugins(\/|$)/ },
  { family: 'Backup and restore', path: /^\/v1\/core\/backup(\/|$)/ },
  { family: 'Security settings', path: /^\/v1\/core\/security(\/|$)/ },
  { family: 'Security settings', methods: ['PUT'], path: /^\/v1\/core\/node\/reach$/ },
  { family: 'Stopping the Node', methods: ['POST'], path: /^\/v1\/core\/node\/stop$/ },
]

/** The refusal message for a request the gateway won't forward, or null to forward it. */
export function refusal(method: string, path: string): string | null {
  // Matched in a form at least as broad as the Node's router sees: decoded, without repeated or
  // trailing slashes, and in lower case. A path that doesn't decode is refused outright.
  let normalized: string
  try {
    normalized = decodeURIComponent(path)
      .replace(/\/+/g, '/')
      .replace(/(.)\/$/, '$1')
      .toLowerCase()
  } catch {
    return 'The gateway refused a path it could not read.'
  }
  const upper = method.toUpperCase()
  const denied = DENIED_ROUTES.find(
    (route) => (!route.methods || route.methods.includes(upper)) && route.path.test(normalized),
  )
  return denied ? `${denied.family} isn't available from a phone. Use Acorn on your computer.` : null
}
