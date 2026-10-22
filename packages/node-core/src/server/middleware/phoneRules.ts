import { createMiddleware } from 'hono/factory'
import { respondError } from '../respond'
import type { AppEnv } from './auth'

// What a phone's device may not do (docs/relay/phone-channel.md § What a phone device may do). A device
// has full owner authority, and a phone is the one client that lives in a browser's storage, so it is
// held to the routes it has a screen for. These are the families it has none for, and the ones that
// decide what code runs or who can get in. Answering a pairing request is allowed: that is what a
// phone is for when it is the one device online.
//
// A test pins this list, so a new family is a reviewed change.
export const PHONE_REFUSED: readonly { family: string; methods?: readonly string[]; path: RegExp }[] = [
  { family: 'Opening a pairing window', path: /^\/v1\/core\/pair(\/start)?$/ },
  { family: 'Managing devices', path: /^\/v1\/core\/devices(\/|$)/ },
  // Every plugin write, so a write route added later is refused too. Reads stay open for the roster.
  { family: 'Plugin settings', methods: ['POST', 'PUT', 'PATCH', 'DELETE'], path: /^\/v1\/core\/plugins(\/|$)/ },
  { family: 'Backup and restore', path: /^\/v1\/core\/backup(\/|$)/ },
  { family: 'Security settings', path: /^\/v1\/core\/security(\/|$)/ },
  { family: 'Security settings', methods: ['PUT'], path: /^\/v1\/core\/node\/reach$/ },
  { family: 'Stopping the Node', methods: ['POST'], path: /^\/v1\/core\/node\/stop$/ },
]

/** The refusal message for a request a phone's device may not make, or null to let it through. */
export function phoneRefusal(method: string, path: string): string | null {
  // Matched in a form at least as broad as the Node's router sees: decoded, without repeated or
  // trailing slashes, and in lower case. A path that doesn't decode is refused outright.
  let normalized: string
  try {
    normalized = decodeURIComponent(path)
      .replace(/\/+/g, '/')
      .replace(/(.)\/$/, '$1')
      .toLowerCase()
  } catch {
    return 'A phone can’t make that request.'
  }
  const upper = method.toUpperCase()
  const refused = PHONE_REFUSED.find(
    (route) => (!route.methods || route.methods.includes(upper)) && route.path.test(normalized),
  )
  return refused ? `${refused.family} isn’t available from a phone. Use Acorn on your computer.` : null
}

export const phoneRules = createMiddleware<AppEnv>(async (c, next) => {
  if (c.get('principal')?.deviceKind === 'phone') {
    const refusal = phoneRefusal(c.req.method, new URL(c.req.url).pathname)
    if (refusal) return respondError(c, 403, 'phone_refused', [refusal])
  }
  await next()
})
