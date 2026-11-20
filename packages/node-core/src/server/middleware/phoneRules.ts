import { createMiddleware } from 'hono/factory'
import { respondError } from '../respond'
import { PLUGIN_NAMESPACE, pluginPhoneAccess } from '../routes/registry'
import type { AppEnv } from './auth'

// What a phone's device may do (docs/relay/phone-channel/phone-devices.md § What a phone device may do). The phone app
// runs on the account website's origin, so anyone who can change what that website serves can act as
// the phone. A phone is therefore held to its screens, and a test pins each list:
//
// - `PHONE_REFUSED` is refused to every phone: who can get in, which plugins run, and the Node itself.
//   So is every write under a plugin mount registered with `phone: 'refused'`, such as the account's
//   sign-in and remote access and Slack's links and approvals.
// - Until a computer gives it shell access, a phone may only read and make the writes its panes make
//   that can't run a program on this computer: core's in `PHONE_ALLOWED`, and a plugin's where its route
//   registration names them (`PhoneWrite`). Anything else needs shell access, including every route
//   added later. A phone with shell access may do everything `PHONE_REFUSED` doesn't refuse.
type PhoneRoute = { family: string; methods?: readonly string[]; path: RegExp }

const READS = ['GET', 'HEAD']
const WRITES = ['POST', 'PUT', 'PATCH', 'DELETE']
const ID = '[^/]+'
const route = (family: string, methods: readonly string[], pattern: string): PhoneRoute => ({
  family,
  methods,
  path: new RegExp(`^${pattern}$`),
})

export const PHONE_REFUSED: readonly PhoneRoute[] = [
  { family: 'Opening a pairing window', path: /^\/v1\/core\/pair(\/start)?$/ },
  { family: 'Managing devices', path: /^\/v1\/core\/devices(\/|$)/ },
  // Every plugin write, so a write route added later is refused too. Reads stay open for the roster.
  { family: 'Plugin settings', methods: WRITES, path: /^\/v1\/core\/plugins(\/|$)/ },
  { family: 'Backup and restore', path: /^\/v1\/core\/backup(\/|$)/ },
  { family: 'Security settings', path: /^\/v1\/core\/security(\/|$)/ },
  { family: 'Security settings', methods: ['PUT'], path: /^\/v1\/core\/node\/reach$/ },
  { family: 'Stopping the Node', methods: ['POST'], path: /^\/v1\/core\/node\/stop$/ },
  // Connections hold credentials, and the account's is what lets the relay reach this Node.
  { family: 'Connections', methods: WRITES, path: /^\/v1\/core\/integrations(\/|$)/ },
]

// Paths here are in the normalized form `phoneRefusal` matches: decoded and in lower case. Reads
// through a plugin's loopback mount are refused before this list (`pluginPhoneAccess`).
export const PHONE_ALLOWED: readonly PhoneRoute[] = [
  { family: 'Reading', methods: READS, path: /^\/v1\// },
  // Answering a pairing request is what a phone is for when it is the one device online.
  route('Pairing', ['POST'], '/v1/pair(/requests(/claim)?)?'),
  route('Pairing', ['POST'], `/v1/core/pair/requests/${ID}`),
  // A task and its worktree, with no setup script: `on-created`, archiving, and restoring run scripts.
  route('Tasks', ['POST'], '/v1/core/tasks'),
  route('Tasks', ['PATCH'], `/v1/core/tasks/${ID}`),
  route('Tasks', ['POST'], `/v1/core/tasks/${ID}/(links|preview-url)`),
  route('Data and dashboards', ['POST'], `/v1/core/(data-sources|queries|dashboards)/${ID}`),
  route('Data and dashboards', ['POST'], '/v1/core/authoring/turn'),
  route('Data and dashboards', ['POST'], '/v1/core/datasets/(correct|drilldown|version)'),
  route('Data and dashboards', ['DELETE'], `/v1/core/datasets/${ID}`),
  route('Dictation', ['POST'], '/v1/core/speech/transcribe'),
  route('Telemetry', ['POST'], '/v1/core/telemetry'),
]

// Why a phone without shell access can't do something that may run a program on the Node.
const PHONE_NEEDS_SHELL =
  'This phone can’t run commands on this Node. On a computer, open Settings → Nodes and give this phone shell access.'

const matches = (route: PhoneRoute, method: string, path: string): boolean =>
  (!route.methods || route.methods.includes(method)) && route.path.test(path)

/** The refusal message for a request a phone's device may not make, or null to let it through. */
export function phoneRefusal(method: string, path: string, shellAccess = false): string | null {
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
  const refused = PHONE_REFUSED.find((route) => matches(route, upper, normalized))
  if (refused) return `${refused.family} isn’t available from a phone. Use Acorn on your computer.`
  const plugin = normalized.startsWith(`${PLUGIN_NAMESPACE}/`) ? pluginPhoneAccess(upper, normalized) : null
  if (plugin === 'refused') return 'That setting isn’t available from a phone. Use Acorn on your computer.'
  if (shellAccess) return null
  if (plugin === 'write') return null
  if (plugin === 'loopback' || !PHONE_ALLOWED.some((route) => matches(route, upper, normalized)))
    return PHONE_NEEDS_SHELL
  return null
}

export const phoneRules = createMiddleware<AppEnv>(async (c, next) => {
  const principal = c.get('principal')
  if (principal?.deviceKind === 'phone') {
    const refusal = phoneRefusal(c.req.method, new URL(c.req.url).pathname, principal.shellAccess)
    if (refusal) return respondError(c, 403, 'phone_refused', [refusal])
  }
  await next()
})
