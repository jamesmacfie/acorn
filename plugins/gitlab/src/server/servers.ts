import { ProviderOperationError, type StoredConnection } from '@acorn/plugin-api/node'
import { codeHostName } from '@acorn/protocol/plugin/contract.ts'
import { GITLAB_HOST, GITLAB_ORIGIN } from './config'

// The GitLab servers this Node has a connection to: gitlab.com, and each company server a person
// connected by its address (docs/gitlab-integration.md § Company servers). Each connection is one
// account on one server. The list lives in memory, rebuilt from the connections at init and whenever
// one changes, and it is the one answer to two questions: which hosts this plugin claims, and which
// connection a call about a host spends.

export type GitlabServer = { connectionId: string; origin: string; host: string }

/** The server address a connection's parsed config names. The token form saves one. A connection
 *  without one, such as a device-flow sign-in, is gitlab.com's. */
export function originOf(config: unknown): string {
  const baseUrl = (config as { baseUrl?: unknown } | null)?.baseUrl
  return typeof baseUrl === 'string' && baseUrl ? baseUrl : GITLAB_ORIGIN
}

/** The server a connection was made to. */
export function serverOf(connection: Pick<StoredConnection, 'id' | 'config'>): GitlabServer {
  let config: unknown = null
  try {
    config = JSON.parse(connection.config)
  } catch {
    // An unreadable config names no address, which is gitlab.com's.
  }
  const origin = originOf(config)
  return { connectionId: connection.id, origin, host: new URL(origin).hostname }
}

// A literal address on this machine or a private network. A name isn't resolved, so a company name that
// points at a private address passes: the check is for an address typed by mistake or on someone's
// say-so, which is where a token sent to the wrong place would hurt.
const PRIVATE_IPV4 = [/^127\./, /^10\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^169\.254\./, /^0\./]
const isPrivateHost = (host: string): boolean =>
  host === 'localhost' || host.endsWith('.localhost') || PRIVATE_IPV4.some((range) => range.test(host))

const refuse = (reason: string): never => {
  throw new ProviderOperationError('provider_bad_config', 400, reason)
}

/**
 * The origin the token form's address names, such as `https://gitlab.example.com`, or gitlab.com's for
 * an empty one. It must be `https` with no path, port, or sign-in, because the browser button and core's
 * host claims match a page by its host alone. A loopback or private address needs `allowPrivate`, the
 * form's confirmation.
 */
export function gitlabOrigin(address: string | undefined, allowPrivate: boolean): string {
  const typed = address?.trim()
  if (!typed) return GITLAB_ORIGIN
  let url: URL
  try {
    url = new URL(typed)
  } catch {
    return refuse(`${typed} isn't a web address. Use the one you open GitLab at, such as https://gitlab.example.com.`)
  }
  if (url.protocol !== 'https:') return refuse('Use an https address for your GitLab server.')
  if (url.username || url.password) return refuse('Leave the sign-in out of the address. Use the token field.')
  if (url.port) return refuse('Acorn connects to GitLab on the standard https port only.')
  if (url.pathname !== '/' || url.search || url.hash)
    return refuse('Use the address of the server alone, such as https://gitlab.example.com, with no path.')
  if (!codeHostName.safeParse(url.hostname).success)
    return refuse(`Acorn can't match projects on ${url.hostname}. Use the server's name.`)
  if (isPrivateHost(url.hostname) && !allowPrivate)
    return refuse(`${url.hostname} is a private address. Tick "Connect to a private address" if you meant it.`)
  return url.origin
}

export type GitlabServers = {
  /** Every server, one per host. */
  all(): GitlabServer[]
  /** The server that serves `host`, or null when no connection is on it. */
  byHost(host: string): GitlabServer | null
  /** The server a connection is on, or null when that connection isn't the one serving its host. */
  byConnection(connectionId: string): GitlabServer | null
  /** Read the connections again, claim each company server's host, and release the ones gone. Runs one
   *  at a time, so connection changes that land together settle in order. */
  sync(): Promise<void>
}

export function createGitlabServers(deps: {
  connections(): Promise<Pick<StoredConnection, 'id' | 'config'>[]>
  claim(host: string): { dispose(): void }
  /** Drop mirror rows of every connection not named, such as one that was disconnected. */
  forgetOthers(connectionIds: string[]): Promise<void>
}): GitlabServers {
  let servers = new Map<string, GitlabServer>()
  const claims = new Map<string, { dispose(): void }>()
  let running: Promise<void> = Promise.resolve()

  const sync = async (): Promise<void> => {
    const connections = await deps.connections()
    const next = new Map<string, GitlabServer>()
    // Connections arrive oldest first, so a second connection to the same server is never used.
    for (const connection of connections) {
      const server = serverOf(connection)
      if (!next.has(server.host)) next.set(server.host, server)
    }
    // A Node that has never had a GitLab connection has no mirror rows, and skipping the purge keeps
    // it from loading the mirror at boot.
    const purge = connections.length > 0 || servers.size > 0
    servers = next
    for (const [host, claim] of claims) {
      if (next.has(host)) continue
      claim.dispose()
      claims.delete(host)
    }
    // gitlab.com is declared, so it needs no claim.
    for (const host of next.keys()) if (host !== GITLAB_HOST && !claims.has(host)) claims.set(host, deps.claim(host))
    if (purge) await deps.forgetOthers(connections.map((connection) => connection.id))
  }

  return {
    all: () => [...servers.values()],
    byHost: (host) => servers.get(host) ?? null,
    byConnection: (connectionId) =>
      [...servers.values()].find((server) => server.connectionId === connectionId) ?? null,
    sync: () => (running = running.catch(() => undefined).then(sync)),
  }
}
