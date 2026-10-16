# Sign in to remote MCP servers

Date: October 16, 2026. Status: implemented October 16, 2026, except the checks against real
servers under "Done when". Starting point: `main` at 495c42499.

This plan lets a person sign in to a remote MCP server from Settings → MCP, once per Node, and have
every agent session on that Node use the sign-in. Read it before you change how the agents plugin
declares MCP servers to a harness. The behavior as built is in
[Signing in to a server](../mcp/sign-in.md).

## Spike findings

Read from the public metadata on October 16, 2026, without signing in:

| Question | Sentry `mcp.sentry.dev` | Linear `mcp.linear.app` |
| --- | --- | --- |
| Revocation endpoint | Yes, `/oauth/token` | Yes, `/token` |
| Client ID metadata documents | Advertised | Advertised |
| Dynamic registration | Yes | Yes |
| Client authentication `none` | Supported | Supported |

Still open, because each needs a browser sign-in: how long an access token lasts, whether a refresh
rotates the refresh token, and whether a loopback redirect on a different port from the registered
one is accepted. The build doesn't depend on the last answer. It registers again whenever the stored
registration doesn't list the attempt's return address, which works either way.

## How the build differs from this plan

- **Refresh.** The relay's upstream doesn't take the library's `authProvider`. The library refreshes
  inside its transport, where two relays can't be made to wait for each other. The upstream gets a
  `fetch` from `McpSignIns.fetchFor()` instead, which adds the token and refreshes once per server at a
  time with `refreshAuthorization()`. Only a refusal (`invalid_grant`, `invalid_client`,
  `unauthorized_client`) marks a sign-in expired. A network or server error fails the one request.
- **Attempts.** The `OAuthClientProvider` belongs to one attempt and keeps everything in memory. The
  table is written once, when the code exchange succeeds, so `redirectToAuthorization()` never has
  to behave differently by caller.
- **Fake server.** The tests use a small fake on `node:http`
  (`plugins/agents/src/server/fakeOauthMcp.helper.ts`), because the library's `mcpAuthRouter` needs
  Express, which the agents plugin doesn't depend on.
- **Names.** `McpReviewProxy` and `McpReviewManager` keep their names.
- **Terminal stop signal.** The terminal plugin had none that covers a removed terminal, so
  `TerminalSessions` gained `onStopped`.
- **The owner's question.** Reviewed servers still skip the relay in a terminal handoff. Only
  signed-in servers go through one.

## Why

Many hosted MCP servers authenticate only through a browser sign-in (OAuth). Sentry's
`https://mcp.sentry.dev/mcp` is one. Acorn can't do that sign-in. A URL server on the **Servers**
page can send only fixed headers (`plugins/agents/src/shared/mcpServers.ts`), and `docs/mcp.md` says
"OAuth sign-in stays with each CLI."

That leaves a person running `claude mcp add` by hand inside every account folder, then signing in
again in each one. A new account folder starts with no MCP servers
([harness accounts](../managed-agents/accounts.md)). Codex needs its own sign-in on top of that.

## What the person sees

On an HTTP server's editor, a **Sign-in** choice sits under the URL:

- **Headers**: today's behavior.
- **Sign in with the server**: Acorn signs in for every session.

With sign-in chosen, the editor shows the state and one action:

| State | Shown | Action |
| --- | --- | --- |
| No tokens stored | Not signed in | **Sign in** |
| Waiting on the browser | Waiting for the browser | **Cancel**, and **Paste the address instead** |
| Tokens stored and the last refresh worked | Signed in, with the date | **Sign out** |
| A refresh was refused | Sign-in expired | **Sign in again** |

**Sign in** opens the server's sign-in page in the browser. When the person approves, the page
lands on a short "You can close this tab" page and the editor flips to **Signed in**.

The list row shows the same state in a word, so a server that needs attention stands out. A session
whose server needs signing in says so in its transcript warning and in its `/mcp` panel, the way a
server with a secret that won't open is handled today.

Two optional fields sit under an **Advanced** disclosure: **Client ID** and **Client secret**. They're
for servers that don't let a client register itself, such as servers that want a pre-made OAuth app.
The client secret is a sealed value like any other secret.

## The design

The Node does all of the OAuth work and keeps the tokens. No harness ever sees a token. Sessions
reach the server through a relay on the Node, and the relay adds the token to each request and
refreshes it when it runs out.

The client's only job is to open the browser and carry the code from the browser's return trip back
to the Node.

### Why the Node and not each CLI

- One sign-in serves every harness account and both harnesses. That's the problem this plan solves.
- The Node already seals secrets and already decides which servers a session gets.
- Tokens never land in a CLI's config folder, so removing a server removes its tokens.

### Why a relay and not a header

The cheaper design reveals the current access token at session start and passes it as a fixed
`Authorization` header. A session runs for hours and resumes days later. The header can't change
once the harness has it, so when the token expires the server quietly fails partway through a
conversation. The spike below measures how long Sentry's tokens last.

The relay already exists. `plugins/agents/src/server/mcpReviewProxy.ts` stands a loopback HTTP
server in front of one MCP server per session, with its own local bearer token, and keeps the
upstream connection itself. The MCP library's `StreamableHTTPClientTransport` takes an
`authProvider` and refreshes the token on its own when a request comes back `401`. So the change is
to give the relay's upstream an auth provider, and to let the relay run without its review gate.

### Why the return trip lands on the client

The browser runs on the person's machine. The Node might not: `pnpm dev:remote` runs it in a
container, and remote Nodes run on other computers. A loopback port on the Node is unreachable from
the browser in those cases.

So the client opens the loopback port, on its own machine, for the length of one sign-in. The
desktop app and the terminal client are both Node.js processes and can do that. A host that can't
(a future browser or phone client) falls back to pasting the address. The paste works everywhere,
because the browser's address bar holds the code even when the page fails to load.

## Phase 0: spike against real servers

Half a day. Write a throwaway script, outside the repo, that signs in to Sentry with the MCP
library's `auth()` and a loopback redirect. Repeat with one more hosted server, such as Linear's
`https://mcp.linear.app/mcp`. Record:

1. How long an access token lasts, and whether a refresh issues a new refresh token (rotation).
2. Whether the server accepts a loopback redirect on a different port from the one it registered.
   This decides the port strategy in phase 1.
3. Whether the server advertises a revocation endpoint.
4. Whether the server supports client ID metadata documents, URL-based client IDs that replace
   dynamic registration. The library supports them through `clientMetadataUrl`.

Put the findings at the top of this file before phase 1 starts.

## Phase 1: the Node signs in and stores tokens

### Stored data

Add a table to the agents plugin, with a migration in `plugins/agents/migrations`:

```ts
// plugins/agents/src/node/schema.ts
export const agentMcpOauth = sqliteTable('agent_mcp_oauth', {
  name: text('name').primaryKey(), // agent_mcp_servers.name
  url: text('url').notNull(), // the server URL the tokens were issued for
  stateJson: text('state_json').notNull(), // sealed tokens, client registration, discovery state
  status: text('status').notNull(), // 'signed_in' | 'expired'
  signedInAt: integer('signed_in_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})
```

Tokens live outside `agent_mcp_servers.config_json` on purpose. `configRevision()` in
`mcpServerStore.ts` hashes that config, and consent and tool approval key on the hash. A refresh
every hour would otherwise void consent every hour.

Add `auth: 'headers' | 'oauth'` and the optional client ID and sealed client secret to the stored
config and to `agentMcpServerInputSchema`. Those are configuration, so they belong in the revision:
switching a server to sign-in asks for consent again, which is right. A row with no `auth` reads as
`'headers'`.

Delete the `agent_mcp_oauth` row when the server is removed, when its URL changes, or when it
switches back to headers. Tokens are bound to the server they were issued for.

### The auth provider

Write one class that implements the library's `OAuthClientProvider` for one server, backed by the
table above and the Node's `SecretService`:

- `tokens()` and `saveTokens()` reveal and seal the token set.
- `clientInformation()` returns the stored registration, or the person's client ID and secret.
  `saveClientInformation()` stores a dynamic registration.
- `saveDiscoveryState()` and `discoveryState()` keep the discovery result, so a refresh doesn't
  repeat discovery.
- `redirectToAuthorization()` behaves differently by caller. During a sign-in it hands the URL to
  the attempt. Anywhere else, such as a relay whose refresh was refused, it marks the server
  `expired` and throws. It never opens a browser from the Node.
- `invalidateCredentials()` clears what the library asks it to clear.

Refreshes must happen one at a time per server. Two sessions sharing a server can both see an
expired token. With rotation, the second refresh spends a refresh token the first one already used,
the server refuses it, and both sessions lose the sign-in. Keep one in-flight refresh per server
name in memory, and have `tokens()` reread the stored set after waiting on it.

### Sign-in attempts

An attempt lives in Node memory only, for 10 minutes, and is single use. It holds the PKCE code
verifier, the `state` value, the redirect URI, and the device that started it. A Node restart
drops attempts, and the person clicks **Sign in** again.

Routes, beside the others in `plugins/agents/src/server/routes/mcpServers.ts`, all behind
`requireDevice`:

| Route | Does |
| --- | --- |
| `POST /mcp-servers/:name/sign-in` | Takes `{ redirectUri }`. Runs discovery and registration through `auth()`, starts an attempt, and returns `{ attemptId, authorizationUrl }`. |
| `POST /mcp-servers/:name/sign-in/:attemptId/finish` | Takes `{ code, state }` or `{ address }`, the pasted address. Checks the state, exchanges the code, and stores the tokens. Returns the server. |
| `DELETE /mcp-servers/:name/sign-in/:attemptId` | Cancels an attempt. |
| `POST /mcp-servers/:name/sign-out` | Revokes the tokens if the server advertises revocation, then deletes the row. A failed revocation still deletes the row. |

Validate `redirectUri` at the route: `http:` with host `127.0.0.1`, `[::1]`, or `localhost`, and
nothing else. Refuse an authorization server URL that isn't `https:`, except for loopback addresses
in tests. Only the device that started an attempt can finish or cancel it.

Registration follows the spike. If the server accepts any loopback port, register once with a
fixed path and reuse the registration. If it wants an exact match, register again when the stored
registration doesn't list the attempt's redirect URI, and keep the newest.

Add the route constants to `plugins/agents/src/shared/mcpServers.ts` and the calls to
`plugins/agents/src/client/settings/mcpServersClient.ts`. Keep the route strings out of
`packages/protocol`, which the arch check forbids.

### The public shape

Add to `AgentMcpServer`:

```ts
auth: 'headers' | 'oauth'
signIn: { status: 'signed_out' | 'signed_in' | 'expired'; signedInAt: number | null } | null // null for headers
clientId: string | null
```

The client secret travels as a secret pair does today: a name and whether one is stored, never the
value.

### Test, diagnostics, and redaction

- `probeMcpServer()` in `mcpProbe.ts` passes the auth provider to its HTTP transport. With no tokens
  it answers "Sign in first" without connecting. `probeMcpCatalogue()` does the same.
- **Check this node** (`securityDiagnostics.ts`) reports the sign-in mode and state, never a token
  or the client ID.
- Every revealed token and client secret joins the secrets list that `safeProviderMessage()` and
  the runtime's `mintedSecrets` redact.

## Phase 2: sessions go through the relay

Pull upstream construction into one function that the probe, the catalogue probe, and the relay all
call. It builds a stdio transport, or an HTTP transport with the server's headers and, when `auth` is
`'oauth'`, its auth provider. Three copies of that construction exist today.

Let the relay run with its review gate off. Today `McpReviewProxy` always starts quarantined and
always gates `tools/list` and `tools/call`. Make the review ports optional: with none, every message
passes through. A server with both sign-in and review on uses one relay with both, not two chained
relays. Rename the class and its manager to say "relay" if the diff stays readable. Otherwise leave
the names.

In `providerMcpServers()` (`plugins/agents/src/server/sessions/runtimeEngine.ts`), send a server
through the relay when it has review on, sign-in on, or both. Today only review does.

When a refresh is refused mid-session, the relay answers the waiting request with an MCP error that
says: "Sign in to `NAME` again in Settings → MCP." It keeps the relay open. A later request after
the person signs in again uses the new tokens, with no session restart.

At session start, a server with sign-in on and no usable tokens is left out with a transcript
warning, the way a server whose secret won't open is left out today.

This covers both harnesses. Claude Code receives the relay on `session/new` and `session/load`.
Codex receives it in `config.mcp_servers` on `thread/start` and `thread/resume`. Codex then reports
the server as connected instead of `needs_auth`.

## Phase 3: the terminal handoff keeps the server

`startTerminalHandoff` in `plugins/agents/src/node/index.ts` calls `mcpServers.resolve()` and hands
the servers straight to `claudeHandoffMcp()` or `codexHandoffMcp()`. It skips the relay. For a
signed-in server that would mean no token, so route those servers through a relay too.

That relay belongs to the terminal, not the session. Key it by terminal ID, and close it when the
terminal stops. Find the terminal plugin's stop signal, the one `terminalHandoffRunning` reads, rather
than polling. The handoff command line names the relay's local URL and its bearer, the bearer going
through the terminal's environment like any other value.

## Phase 4: the client side

### A platform seam for the return trip

Add a nullable group to the client platform seam in `packages/client-core/src/infra/platform/`,
listed in `contract.ts` like the others:

```ts
export type OauthCallback = {
  /** Opens a one-request listener on 127.0.0.1 and an unguessable path. */
  listen(): Promise<{
    redirectUri: string
    /** The query string the browser arrived with. Rejects on timeout or close. */
    result: Promise<URLSearchParams>
    close(): void
  }>
}
```

Implement it in the desktop shell (`apps/desktop`) and the terminal client (`apps/tui`). The
listener:

- Binds `127.0.0.1` on a random port. If phase 0 found a server that wants a fixed port, use a fixed
  port per host and say so here.
- Answers the first request on its path with a static page that says the tab can be closed. It never
  echoes the query string into the page.
- Answers anything else with `404`, and closes after the first good request or after 10 minutes.

A host without the group gets the paste flow only.

### The flow in the editor

1. **Sign in**: call `listen()` if the host has it, then the sign-in route with its redirect URI.
   Without `listen()`, use a fixed `http://127.0.0.1/acorn-oauth` redirect URI that loads nothing.
2. Open `authorizationUrl` in the browser, the way a kit `Link` with an external `href` does. The
   terminal client prints the link as well, because the person may be on SSH.
3. When `result` resolves, send `code` and `state` to the finish route. When the person pastes an
   address instead, send it as `address` and let the Node parse it.
4. Refetch `agentMcpServersQueryKey`.

Close the listener and cancel the attempt when the person cancels, leaves the editor, or the
attempt times out.

The editor lives in `plugins/agents/src/client/settings/AgentMcpServersSettings.tsx`. Use the
closed kit's existing parts. The `/mcp` panel's `needs_auth` label in `AgentMcpPanel.tsx` already
reads "needs sign-in". Point it at Settings for a server Acorn signs in to.

## Phase 5: docs and real checks

Update:

- `docs/mcp.md`, the "Your own servers" section. Replace "OAuth sign-in stays with each CLI" with
  what this plan builds, and keep that sentence for servers that come from a CLI's own config.
- `docs/mcp/managed-servers.md`, where it describes the review relay.
- `docs/managed-agents/accounts.md`. One sign-in serves every account on a Node.
- `docs/future/README.md`, with this plan's row and its status.

## Out of scope

- **SSE transport.** The **Servers** page offers only Streamable HTTP. Hosted servers that offer
  sign-in offer that too.
- **Client ID metadata documents.** These need an `https` address that hosts Acorn's client
  metadata, such as one on `acorn.sh`. Add them when a server Acorn wants requires them.
- **Sharing a sign-in between Nodes.** Each Node signs in for itself. Copying tokens between Nodes
  would move credentials over a channel built for task data.
- **Servers in a CLI's own config.** Those stay with the CLI, as they do today.

## Tests

The MCP library ships an OAuth server side (`mcpAuthRouter` and a demo in-memory provider). Use it
to run a fake signed-in MCP server on a loopback port in tests:

- The provider seals what it stores and never returns a token through `list()` or `get()`.
- Two relays refresh at once and the fake server sees one refresh request.
- A refused refresh marks the server `expired`, the relay answers with the sign-in error, and a new
  sign-in recovers the same relay with no restart.
- An attempt refuses a wrong `state`, a second use, another device, and an expired attempt.
- `redirectUri` validation refuses non-loopback hosts and `https:`.
- Changing the URL or removing the server deletes the tokens.
- Session start leaves out a server with no tokens and records the warning.
- The terminal handoff relay closes when the terminal stops.
- The platform contract test covers the new group in both shells.

Run focused tests with `pnpm test:focus <exact package name> <file filter>`.

## Done when

- A person signs in to Sentry once in Settings → MCP, then a Claude Code session on the `personal`
  account and one on a second account both list Sentry tools without any `claude mcp add`.
- A Codex session on the same Node reports Sentry connected.
- The same steps work with the Node in a container through `pnpm dev:remote`, using the loopback
  return trip, and again using the pasted address.
- A session started before an access token expires keeps working after it expires. Force the
  expiry by editing the stored expiry time on a test Node.
- **Sign out** removes the server's tools from the next session start.
- A terminal handoff keeps Sentry's tools.
- No token appears in a transcript, a log, a `ps` listing, or a route response.

## Risks and limits

- A handed-off terminal on the tmux backend can outlive a Node restart. Its relay doesn't, so that
  terminal loses the server until the person hands off again. Write this into the docs rather than
  persisting relays.
- A server that rotates refresh tokens and drops a refresh reply mid-flight loses the sign-in. The
  person signs in again. Nothing on the client side can fix that.
- The relay adds one local hop per MCP request. The review relay already pays this cost for
  reviewed servers.
- A pasted address carries a one-time code. The Node rejects it once used, but the field still
  clears itself after it submits.

## Question for the owner

Phase 3 routes signed-in servers through a relay in the terminal handoff. Reviewed servers skip the
review relay there today, because the handoff hands over servers straight from `resolve()`. Decide
whether phase 3 should send reviewed servers through the relay as well. That's a one-line change once
the relay exists, but it changes what a person sees in a handed-off terminal.
