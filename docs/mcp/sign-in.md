# Signing in to a server

This page covers how Acorn signs in to a remote MCP server once per Node for every session. Read it
before you change how a signed-in server's token reaches a request.

Many hosted MCP servers authenticate only through a browser sign-in (OAuth), such as Sentry's
`https://mcp.sentry.dev/mcp`. For one of these, choose **Sign in with the server** under the URL in the
server's editor, save, and click **Sign in**. One sign-in serves every session on the Node, on every
harness account and both harnesses. The editor and the list row show **Not signed in**, **Signed in**,
or **Sign-in expired**.

The Node does all of the OAuth work and keeps the tokens, so no harness ever holds one:

- **Tokens.** `McpSignIns` in `plugins/agents/src/server/mcpSignIn.ts` keeps one sealed row per server in
  `agent_mcp_oauth`: tokens, the client registration, and the discovered endpoints. They live outside
  the server's config on purpose, because consent and tool approval key on that config's digest and a
  refresh would void both. Changing the URL or the client, switching back to headers, or removing the
  server drops the row. **Sign out** revokes the refresh token where the server offers revocation, then
  drops the row either way.
- **Signing in.** The Node runs discovery and registration with the MCP library's `auth()`. A sign-in
  attempt stays in Node memory for 10 minutes, belongs to the device that started it, and works once.
  It writes nothing until the code exchange succeeds, so an abandoned attempt never disturbs a working
  sign-in. Every sign-in request goes to an `https:` address. Plain `http:` on
  loopback is allowed only for a server the person set up on loopback, so a remote server's metadata
  can't point the Node at its own machine. Each redirect is checked against the same rule.
- **The return trip.** The browser runs on the person's machine, and the Node might not. The client opens
  a one-request listener on `127.0.0.1` for the length of the sign-in (`oauthCallback` in the platform
  seam, `packages/custody/src/oauthCallback.ts`). Both the desktop, in its helper process, and the
  terminal client have it. Where the browser can't reach that port, such as over SSH, or on a host
  without the listener, the person pastes the address the browser landed on. The address bar holds the
  code even when the page fails to load.
- **Sessions.** A signed-in server always reaches the harness through the relay that review uses
  ([managed MCP servers](./managed-servers.md)). The relay adds the token to each request. On a 401
  it refreshes once and repeats the request, one refresh at a time per server, because a server that
  rotates refresh tokens refuses the second of two refreshes made with the same token. When the server
  refuses a refresh, the sign-in reads **Sign-in expired**, and the relay answers the agent with "Sign in
  to NAME again in Settings → MCP." The relay stays open, so the next request after a new sign-in
  works without a restart.
- **Session start.** A server with no usable sign-in is left out with a transcript warning, the way a
  server whose secret won't open is. The `/mcp` panel marks it **needs sign-in** and links to Settings.
- **Terminal handoff.** A signed-in server reaches a handed-off terminal through a relay of its own,
  closed when the terminal stops (`plugins/agents/src/server/terminalHandoffRelays.ts`). The relay's local
  URL and bearer go through the terminal's environment like any other value. A tmux terminal that
  outlives a Node restart loses the server, because the relay doesn't survive the restart. Hand off
  again to get it back. Reviewed servers still go to a terminal directly.

**Advanced** holds **Client ID** and **Client secret**, for a server that doesn't let a client register
itself. The client secret is sealed like any other secret. Without a client ID, Acorn registers itself
with the server and registers again whenever the stored registration doesn't list the attempt's return
address.

**Check this node** reports each server's sign-in mode and state, never a token or the client ID.

Not built: the SSE transport, client ID metadata documents, and sharing a sign-in between Nodes.

