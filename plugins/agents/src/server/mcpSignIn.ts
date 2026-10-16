// Signing in to a remote MCP server once per node, for every session (docs/mcp/sign-in.md).
//
// The node does the OAuth work and keeps the tokens, so no harness ever holds one. A session reaches a
// signed-in server through the relay (McpReviewProxy), whose upstream sends every request through
// `fetchFor()`: that adds the token and refreshes it when the server answers 401. The client's part is
// to open the browser and carry the code from the return trip back here.
//
// A sign-in attempt lives in memory only. Everything it learns (the registration, the discovered
// endpoints, the code verifier) stays on the attempt until the code exchange succeeds, so a sign-in
// that is abandoned halfway never disturbs a sign-in that still works.
import { randomBytes, randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import {
  auth,
  refreshAuthorization,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
} from '@modelcontextprotocol/sdk/client/auth.js'
import {
  InvalidClientError,
  InvalidGrantError,
  UnauthorizedClientError,
} from '@modelcontextprotocol/sdk/server/auth/errors.js'
import type { OAuthClientInformationMixed, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js'
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { PluginDatabase, SecretService } from '@acorn/plugin-api/node'
import * as schema from '../node/schema'
import type { AgentMcpSignInFinish, AgentMcpSignInStarted } from '../shared/mcpServers'

const ATTEMPT_MS = 10 * 60_000
const REVOKE_MS = 10_000
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '[::1]', 'localhost'])

/** What a request to a signed-in server fails with when the sign-in is gone or was refused. The relay
 *  hands this message to the agent and stays open, so the next request after a new sign-in works. */
export class McpSignInRequired extends Error {
  constructor(server: string) {
    super(`Sign in to ${server} again in Settings → MCP.`)
  }
}

/** A pre-made OAuth client the person entered, for a server that does not let a client register. */
export type McpConfiguredClient = { clientId: string; clientSecret: string | null }

type SignInState = {
  tokens: OAuthTokens
  client: OAuthClientInformationMixed
  discovery: OAuthDiscoveryState
  /** The resource indicator the tokens were issued for, sent again with each refresh. */
  resource: string | null
}

type Loaded = { url: string; status: string; sealed: string; state: SignInState }

type Attempt = {
  id: string
  name: string
  url: string
  deviceId: string
  redirectUri: string
  state: string
  expiresAt: number
  timer: NodeJS.Timeout
  /** The person entered this client, so it is never swapped for a registration. */
  configured: boolean
  client?: OAuthClientInformationMixed
  discovery?: OAuthDiscoveryState
  codeVerifier?: string
  tokens?: OAuthTokens
  authorizationUrl?: URL
  resource: string | null
}

const MAX_REDIRECTS = 5
const loopbackHttp = (url: URL) => url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname)

// The fetch for discovery, registration, token and revocation requests to the server at `serverUrl`.
// They go to https only, so a token or a client secret never crosses the network in the clear. Plain
// http on loopback is allowed only for a server the person set up on loopback themselves, which is
// also how the tests run their fake: a remote server's metadata can't point the node at this machine.
// Redirects are followed here rather than by fetch, so every hop passes the same check, and only for
// a read, so a request body is never replayed somewhere else.
export function signInFetch(serverUrl: string): FetchLike {
  const local = loopbackHttp(new URL(serverUrl))
  return async (input, init) => {
    let url = new URL(String(input))
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (url.protocol !== 'https:' && !(local && loopbackHttp(url)))
        throw new Error(`Sign-in needs https addresses, and ${url.origin} is not one.`)
      const response = await fetch(url, { ...init, redirect: 'manual' })
      const location = response.headers.get('location')
      const read = !init?.method || init.method === 'GET' || init.method === 'HEAD'
      if (response.status < 300 || response.status >= 400 || !location || !read) return response
      await response.body?.cancel()
      url = new URL(location, url)
    }
    throw new Error(`Sign-in stopped after ${MAX_REDIRECTS} redirects.`)
  }
}

const withBearer = (init: RequestInit | undefined, token: string): RequestInit => {
  const headers = new Headers(init?.headers)
  headers.set('authorization', `Bearer ${token}`)
  return { ...init, headers }
}

// A dynamic registration names the return addresses it accepts. One made for another port is no use
// to this attempt, so the attempt registers again rather than finding out at the server's sign-in page.
const registeredFor = (client: OAuthClientInformationMixed, redirectUri: string): boolean =>
  'redirect_uris' in client && Array.isArray(client.redirect_uris) && client.redirect_uris.includes(redirectUri)

// The refusals that mean the refresh token or the client is no good. Anything else, a network failure
// or a server error, may pass, so it fails the one request and keeps the sign-in.
const refused = (error: unknown): boolean =>
  error instanceof InvalidGrantError || error instanceof InvalidClientError || error instanceof UnauthorizedClientError

function returnedParams(address: string, redirectUri: string): URLSearchParams {
  let url: URL
  try {
    url = new URL(address.trim())
  } catch {
    throw new Error("Paste the whole address from the browser's address bar.")
  }
  const expected = new URL(redirectUri)
  if (url.origin !== expected.origin || url.pathname !== expected.pathname)
    throw new Error('That address is not where this sign-in returns to. Paste the address the browser landed on.')
  return url.searchParams
}

export class McpSignIns {
  readonly #db: PluginDatabase
  readonly #secrets: SecretService
  readonly #redact: (value: string) => void
  readonly #attempts = new Map<string, Attempt>()
  // The revealed state of each server's row. This class is the only writer of the table, so every
  // write below updates the entry too.
  readonly #loaded = new Map<string, Loaded>()
  // One refresh at a time per server. A server that rotates refresh tokens refuses the second of two
  // refreshes made with the same token, and that would sign out every session sharing the server.
  readonly #refreshing = new Map<string, Promise<string>>()

  constructor(db: PluginDatabase, secrets: SecretService, redact: (value: string) => void) {
    this.#db = db
    this.#secrets = secrets
    this.#redact = redact
  }

  /** Every stored sign-in, without revealing any of them. */
  async statuses(): Promise<Map<string, { url: string; status: 'signed_in' | 'expired'; signedInAt: number }>> {
    const rows = await this.#db
      .select({
        name: schema.agentMcpOauth.name,
        url: schema.agentMcpOauth.url,
        status: schema.agentMcpOauth.status,
        signedInAt: schema.agentMcpOauth.signedInAt,
      })
      .from(schema.agentMcpOauth)
    return new Map(
      rows.map((row) => [
        row.name,
        { url: row.url, status: row.status === 'signed_in' ? 'signed_in' : 'expired', signedInAt: row.signedInAt },
      ]),
    )
  }

  /** The token values a session start may meet, for its redaction list, or null when the server has no
   *  usable sign-in: none for this exact URL, or one the server refused. */
  async secretsFor(name: string, url: string): Promise<string[] | null> {
    const state = (await this.#signedIn(name, url))?.state
    if (!state) return null
    return [state.tokens.access_token, state.tokens.refresh_token, state.client.client_secret].filter(
      (value): value is string => !!value,
    )
  }

  /**
   * Starts a sign-in: discovers the server's sign-in endpoints, registers a client if it needs one, and
   * returns the page the browser opens. `redirectUri` is the route-checked loopback address the
   * browser comes back to. A second start for the same server replaces the first.
   */
  async start(
    name: string,
    url: string,
    redirectUri: string,
    deviceId: string,
    configured: McpConfiguredClient | null,
  ): Promise<AgentMcpSignInStarted> {
    for (const attempt of this.#attempts.values()) if (attempt.name === name) this.#drop(attempt.id)
    const id = randomUUID()
    const stored = await this.#load(name)
    const reusable = stored?.url === url ? stored.state : null
    const attempt: Attempt = {
      id,
      name,
      url,
      deviceId,
      redirectUri,
      state: randomBytes(32).toString('base64url'),
      expiresAt: Date.now() + ATTEMPT_MS,
      timer: setTimeout(() => this.#drop(id), ATTEMPT_MS).unref(),
      configured: !!configured,
      discovery: reusable?.discovery,
      client: configured
        ? {
            client_id: configured.clientId,
            ...(configured.clientSecret ? { client_secret: configured.clientSecret } : {}),
          }
        : reusable && registeredFor(reusable.client, redirectUri)
          ? reusable.client
          : undefined,
      resource: null,
    }
    this.#attempts.set(id, attempt)
    try {
      const result = await auth(this.#provider(attempt), { serverUrl: url, fetchFn: signInFetch(url) })
      if (result !== 'REDIRECT' || !attempt.authorizationUrl)
        throw new Error('The server did not ask for a sign-in, so there is nothing to sign in to.')
    } catch (error) {
      this.#drop(id)
      throw error
    }
    if (attempt.client?.client_secret) this.#redact(attempt.client.client_secret)
    return { attemptId: id, authorizationUrl: attempt.authorizationUrl.href }
  }

  /** Finishes a sign-in with the browser's return trip, and stores the tokens. An attempt is single use. */
  async finish(name: string, attemptId: string, deviceId: string, input: AgentMcpSignInFinish): Promise<void> {
    const attempt = this.#attempts.get(attemptId)
    if (!attempt || attempt.name !== name || attempt.deviceId !== deviceId || Date.now() > attempt.expiresAt)
      throw new Error('No sign-in is waiting for this server. Start again.')
    this.#drop(attemptId)
    const returned = 'address' in input ? returnedParams(input.address, attempt.redirectUri) : null
    const error = returned?.get('error')
    if (error) throw new Error(`The server refused the sign-in (${error.slice(0, 64)}).`)
    const code = returned ? returned.get('code') : 'code' in input ? input.code : null
    const state = returned ? returned.get('state') : 'state' in input ? input.state : null
    if (!code || state !== attempt.state)
      throw new Error('This return trip belongs to a different sign-in. Start again.')
    const result = await auth(this.#provider(attempt), {
      serverUrl: attempt.url,
      authorizationCode: code,
      fetchFn: signInFetch(attempt.url),
    })
    const { tokens, client, discovery } = attempt
    if (result !== 'AUTHORIZED' || !tokens || !client || !discovery)
      throw new Error('The server did not issue tokens for this sign-in.')
    await this.#store(name, attempt.url, { tokens, client, discovery, resource: attempt.resource })
  }

  cancel(name: string, attemptId: string, deviceId: string): boolean {
    const attempt = this.#attempts.get(attemptId)
    if (!attempt || attempt.name !== name || attempt.deviceId !== deviceId) return false
    this.#drop(attemptId)
    return true
  }

  /** Revokes the tokens where the server offers that, then forgets them. A failed revocation still forgets. */
  async signOut(name: string): Promise<void> {
    try {
      const stored = await this.#load(name)
      // Not on the library's OpenID metadata type, though OpenID providers may list one too.
      const endpoint = (stored?.state.discovery.authorizationServerMetadata as { revocation_endpoint?: unknown })
        ?.revocation_endpoint
      if (stored && typeof endpoint === 'string') {
        const { tokens, client } = stored.state
        const body = new URLSearchParams({
          token: tokens.refresh_token ?? tokens.access_token,
          token_type_hint: tokens.refresh_token ? 'refresh_token' : 'access_token',
          client_id: client.client_id,
          ...(client.client_secret ? { client_secret: client.client_secret } : {}),
        })
        await signInFetch(stored.url)(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body,
          signal: AbortSignal.timeout(REVOKE_MS),
        })
          .then((response) => response.body?.cancel())
          .catch(() => undefined)
      }
    } finally {
      await this.forget(name)
    }
  }

  /** Drops the server's tokens and any sign-in under way, such as when the server is removed or changed. */
  async forget(name: string): Promise<void> {
    for (const attempt of this.#attempts.values()) if (attempt.name === name) this.#drop(attempt.id)
    this.#loaded.delete(name)
    await this.#db.delete(schema.agentMcpOauth).where(eq(schema.agentMcpOauth.name, name))
  }

  /** The fetch a connection to a signed-in server uses. It adds the token, and on a 401 it refreshes
   *  once and repeats the request. A refused refresh marks the sign-in expired. */
  fetchFor(name: string, url: string): FetchLike {
    return async (input, init) => {
      const token = (await this.#signedIn(name, url))?.state.tokens.access_token
      if (!token) throw new McpSignInRequired(name)
      const first = await fetch(input, withBearer(init, token))
      if (first.status !== 401) return first
      await first.body?.cancel()
      const fresh = await this.#refresh(name, url, token)
      const second = await fetch(input, withBearer(init, fresh))
      if (second.status !== 401) return second
      await second.body?.cancel()
      await this.#expire(name)
      throw new McpSignInRequired(name)
    }
  }

  #refresh(name: string, url: string, stale: string): Promise<string> {
    let running = this.#refreshing.get(name)
    if (!running) {
      running = this.#refreshOnce(name, url, stale).finally(() => this.#refreshing.delete(name))
      this.#refreshing.set(name, running)
    }
    return running
  }

  async #refreshOnce(name: string, url: string, stale: string): Promise<string> {
    const signedIn = await this.#signedIn(name, url)
    if (!signedIn) throw new McpSignInRequired(name)
    const current = signedIn.state
    // Another request refreshed while this one waited for its 401.
    if (current.tokens.access_token !== stale) return current.tokens.access_token
    const refreshToken = current.tokens.refresh_token
    if (!refreshToken) {
      await this.#expire(name)
      throw new McpSignInRequired(name)
    }
    let tokens: OAuthTokens
    try {
      tokens = await refreshAuthorization(current.discovery.authorizationServerUrl, {
        metadata: current.discovery.authorizationServerMetadata,
        clientInformation: current.client,
        refreshToken,
        resource: current.resource ?? undefined,
        fetchFn: signInFetch(url),
      })
    } catch (error) {
      if (!refused(error)) throw error
      await this.#expire(name)
      throw new McpSignInRequired(name)
    }
    const next = { ...current, tokens: { ...tokens, issuer: current.tokens.issuer } }
    if (await this.#replace(name, signedIn, next)) return next.tokens.access_token
    const latest = await this.#signedIn(name, url)
    if (!latest) throw new McpSignInRequired(name)
    return latest.state.tokens.access_token
  }

  // The OAuth library's view of one attempt. Nothing here touches the table.
  #provider(attempt: Attempt): OAuthClientProvider {
    return {
      redirectUrl: attempt.redirectUri,
      clientMetadata: {
        client_name: 'Acorn',
        redirect_uris: [attempt.redirectUri],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      },
      state: () => attempt.state,
      clientInformation: () => attempt.client,
      saveClientInformation: (client) => {
        attempt.client = client
      },
      tokens: () => attempt.tokens,
      saveTokens: (tokens) => {
        attempt.tokens = tokens
      },
      redirectToAuthorization: (authorizationUrl) => {
        attempt.authorizationUrl = authorizationUrl
        attempt.resource = authorizationUrl.searchParams.get('resource')
      },
      saveCodeVerifier: (verifier) => {
        attempt.codeVerifier = verifier
      },
      codeVerifier: () => {
        if (!attempt.codeVerifier) throw new Error('This sign-in has no code verifier. Start again.')
        return attempt.codeVerifier
      },
      saveDiscoveryState: (discovery) => {
        attempt.discovery = discovery
      },
      discoveryState: () => attempt.discovery,
      invalidateCredentials: (scope) => {
        // A client the person entered stays: registering a new one instead is not what they asked for.
        if ((scope === 'all' || scope === 'client') && !attempt.configured) attempt.client = undefined
        if (scope === 'all' || scope === 'tokens') attempt.tokens = undefined
        if (scope === 'all' || scope === 'verifier') attempt.codeVerifier = undefined
        if (scope === 'all' || scope === 'discovery') attempt.discovery = undefined
      },
    }
  }

  #drop(attemptId: string): void {
    const attempt = this.#attempts.get(attemptId)
    if (!attempt) return
    clearTimeout(attempt.timer)
    this.#attempts.delete(attemptId)
  }

  async #signedIn(name: string, url: string): Promise<Loaded | null> {
    const loaded = this.#loaded.get(name) ?? (await this.#load(name))
    return loaded && loaded.url === url && loaded.status === 'signed_in' ? loaded : null
  }

  async #load(name: string): Promise<Loaded | null> {
    const [row] = await this.#db.select().from(schema.agentMcpOauth).where(eq(schema.agentMcpOauth.name, name))
    if (!row) return null
    let state: SignInState
    try {
      state = JSON.parse(await this.#secrets.reveal(row.stateJson, 'agent MCP server: use a sign-in')) as SignInState
    } catch {
      // A seal this node can no longer open, such as after its key changed: the same as signed out.
      return null
    }
    this.#redactState(state)
    const loaded = { url: row.url, status: row.status, sealed: row.stateJson, state }
    this.#loaded.set(name, loaded)
    return loaded
  }

  async #store(name: string, url: string, state: SignInState): Promise<void> {
    const sealed = await this.#secrets.seal(JSON.stringify(state))
    const now = Date.now()
    await this.#db
      .insert(schema.agentMcpOauth)
      .values({ name, url, stateJson: sealed, status: 'signed_in', signedInAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: schema.agentMcpOauth.name,
        set: { url, stateJson: sealed, status: 'signed_in', signedInAt: now, updatedAt: now },
      })
    this.#redactState(state)
    this.#loaded.set(name, { url, status: 'signed_in', sealed, state })
  }

  // After a refresh. Conditional on the row the refresh started from, so a sign-out or a new sign-in
  // that landed meanwhile is not overwritten with tokens from before it. Answers whether it wrote.
  async #replace(name: string, before: Loaded, state: SignInState): Promise<boolean> {
    const sealed = await this.#secrets.seal(JSON.stringify(state))
    const changed = await this.#db
      .update(schema.agentMcpOauth)
      .set({ stateJson: sealed, updatedAt: Date.now() })
      .where(and(eq(schema.agentMcpOauth.name, name), eq(schema.agentMcpOauth.stateJson, before.sealed)))
      .returning({ name: schema.agentMcpOauth.name })
    this.#redactState(state)
    if (!changed.length) {
      this.#loaded.delete(name)
      return false
    }
    this.#loaded.set(name, { ...before, sealed, state })
    return true
  }

  async #expire(name: string): Promise<void> {
    await this.#db
      .update(schema.agentMcpOauth)
      .set({ status: 'expired', updatedAt: Date.now() })
      .where(eq(schema.agentMcpOauth.name, name))
    const loaded = this.#loaded.get(name)
    if (loaded) loaded.status = 'expired'
  }

  #redactState(state: SignInState): void {
    this.#redact(state.tokens.access_token)
    if (state.tokens.refresh_token) this.#redact(state.tokens.refresh_token)
    if (state.client.client_secret) this.#redact(state.client.client_secret)
  }
}
