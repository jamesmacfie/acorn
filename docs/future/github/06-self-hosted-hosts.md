# Phase 6: let a code host claim hosts at runtime

## Completion note

October 17, 2026. Done, verified against the fake GitLab API served at `https://gitlab.example.test`.

What landed:

- `codeHost.selfHosted` in `packages/protocol/src/plugin/contract.ts`, with the host rule pulled out as
  `codeHostName`. The manifest schema is regenerated.
- `ctx.codeHosts.claim(host)` on both tiers, which returns a `Disposable`. `claimCodeHost` in
  `packages/node-core/src/server/pluginHost/codeHosts.ts` keeps each claim on the plugin's code host
  entry, so a claim goes with the declaration when the plugin stops. `heldHosts(pluginId)` lists the
  declared and claimed hosts the plugin wins. A claim and a release broadcast `plugins:changed`.
- `{codeHost}` patterns: `expandCodeHostPattern` and `checkDeclaredContentLinkPattern` in
  `packages/protocol/src/content/contentLinkPattern.ts`. Discovery expands handoff patterns on each
  read. The roster row carries `codeHosts`, and the client's chrome pass expands content links from it
  and registers them again when it changes.
- `ctx.providers.connections(userId, providerId)`, and an optional `connectionId` on
  `ctx.providers.withConnection`, `providerCredential`, and `refreshProviderCredential`.
- A `checkbox` credential field, drawn in Settings, the wizard, and the terminal client's setup. The
  connect form shows a provider's refusal reason when it gives one.
- The trust prompt's **Provides** group has a code host line, which says a `selfHosted` one can add
  hosts and receives the paths of their projects.
- The client refetches projects on `plugins:changed`, so a provider that a claim, a release, or a
  disabled code host changes reaches the project list.
- GitLab: a **GitLab address** field and a **Connect to a private address** checkbox on the token
  form, `maxConnections` 8, `selfHosted`, `{codeHost}` handoff patterns, and `createGitlabServers` in
  `plugins/gitlab/src/server/servers.ts`, which claims each company server's host at init and on every
  `connection:changed`. The mirror is keyed by `connection_id`. The plugin never shipped, so its one
  migration, `0000`, is regenerated to create that schema directly. Every call goes to the session's
  `origin`.
- [Self-hosted code hosts](../../plugins/self-hosted-code-hosts.md) is a new page, and
  [code hosts](../../plugins/code-hosts.md), [browser handoffs](../../plugin-authoring/browser-handoffs.md),
  [GitLab integration](../../gitlab-integration.md), and the site's GitLab and reference pages describe
  it.

Decisions and deviations:

- One plugin with many connections, not one connection per host. Each connection is one account on one
  server, and the plugin keeps one server per host in memory. The oldest connection to a host serves it,
  and a second one to the same server is never used. Validation can't refuse it, because replacing a
  key validates the same way.
- The client threads a project address, `host/path`, instead of a bare path. Project routes are
  `/v1/p/gitlab/projects/:host/:path/...`, and refs are `gitlab.com/group/api!12` on every server,
  gitlab.com included, because a path alone can name projects on two servers. Event payloads carry
  `projectAddress` in place of `projectPath`.
- `GET /v1/p/gitlab/servers`, device only, lists each server's host and connection, so the client links
  a new task under the connection on its merge request's server.
- The device flow stays on gitlab.com. A company server signs in with a token only. Offering the device
  flow with a person's own client id needs core's device code screen to collect fields first, which
  nothing else needs yet.
- The private address check reads the literal address only: `localhost`, `*.localhost`, and the
  loopback, private, and link-local IPv4 ranges. A name isn't resolved. An address with a path, a port,
  or an IPv6 literal is refused, because the browser button and the claim match by host alone.
- A content link to a merge request on a company server opens in Acorn when a tracked project is on
  that server. Otherwise it opens in the browser.
- Replacing a company server's key without its address moves the connection to gitlab.com, and
  validation refuses the company token there, so nothing is saved.

For later phases:

- Phase 8: a Bitbucket plugin for Bitbucket Cloud declares a fixed host and needs none of this. The same
  claim, `{codeHost}`, and per-connection `origin` serve a Bitbucket Data Center plugin if one is wanted.
- GitHub Enterprise needs the GitHub plugin's mirror keyed by connection, the same as GitLab's here.
- The desktop's image policy allows gitlab.com avatars only, so it doesn't load a company server's.
- Core's `byRepository(provider, path)` and `adoptChangeRequests(provider, path, ...)` don't take a
  host, so two servers holding the same path can be confused there.
- Already red at the base and untouched: the `pluginDisable` and `routeRegistry` goldens in `apps/node`
  (the browser-panel and agents MCP routes), three `docPaths` entries for `dist` files, knip's
  `proposalChanges`, two `cssHygiene` checks in client-core, and three site unit tests. The goldens
  gained only `gitlab/servers`.

Date: October 16, 2026. Status: proposed. Depends on [phase 5](./05-gitlab-plugin.md).

## Goal

A person whose company runs its own GitLab connects it by address, and its projects, merge requests,
and browser button work as gitlab.com's do. The same mechanism serves a Bitbucket or GitHub
Enterprise server later.

## Starting point

- A code host's `hosts` list is fixed when the plugin registers. `declareCodeHost` in
  `packages/node-core/src/server/pluginHost/codeHosts.ts` parses it once, from the manifest or from
  `NodePlugin.codeHost`. A host nobody knew at build time can't be claimed, so its projects get no
  provider and no change request behavior.
- A browser handoff's `match` patterns name a fixed host, such as
  `https://github.com/{owner}/{repo}/pull/{number}`, and register the same way, in
  `packages/node-core/src/server/pluginHost/browserHandoffs.ts`. Content links on the client do too.
- A connection is one account on one service. GitHub sets `maxConnections: 1` in
  `plugins/github/src/server/provider.ts`, because its mirror tables are keyed by login only.
- The browser extension asks for each site's permission at runtime, from
  `optional_host_permissions` in `apps/extension/src/manifest.ts`. A self-hosted origin needs no
  extension release, only the person's grant.

## The design

A code host declares `selfHosted: true` beside `hosts`. Such a plugin can claim more hosts while it
runs, through `ctx.codeHosts.claim(host)`, which returns a release. Claims follow the same tie rules as
declared hosts: a built-in beats a loaded plugin, and a lower plugin id beats a higher one. Core stores
nothing. The plugin claims each host again at init from its own connections, so turning the plugin
off releases them, and the stored provider on each project stands in, as it does for a plugin that stops.

A pattern can name `{codeHost}` as its host, for example
`https://{codeHost}/{path+}/-/merge_requests/{number}`. Core expands it into one pattern per host the
plugin holds, declared or claimed, and expands again when a claim changes. Content links take the same
placeholder.

Each connection on a self-hosted code host carries its base URL. The plugin keys its mirror rows by
connection, not by login alone, so two servers with the same username don't collide. That lifts
`maxConnections` above one for GitLab. GitHub stays at one until someone needs GitHub Enterprise.

Sign-in on a company server uses a personal access token. The device flow needs an OAuth application
registered on that server, which acorn can't do for the person. Offer the device flow only when the
person also enters a client id.

## Changes

1. Add `selfHosted` to the code host descriptor in `packages/protocol/src/plugin/contract.ts`, and
   `claim(host)` to the node plugin context. Refuse a claim from a plugin that didn't declare
   `selfHosted`, and refuse a host that isn't a bare lowercase name, the rule declared hosts follow.
2. Add `{codeHost}` expansion for browser handoffs and content links, on the node and the client.
3. In the GitLab plugin, add a base URL field to the token form, claim the host on connect and at
   init, release it on disconnect, and key the mirror by connection. Raise `maxConnections`.
4. Call each server's API at the connection's base URL. Validate it as an `https` URL, and refuse a
   loopback or private address unless the person confirms it.
5. Update [code hosts](../../plugins/code-hosts.md) and
   [browser handoffs](../../plugin-authoring/browser-handoffs.md).

## Out of scope

GitHub Enterprise Server. The design covers it, but the GitHub plugin's mirror keys and client id
handling would need the same changes as step 3, and nobody has asked.

## Acceptance

- Connect `gitlab.example.test`, served by the fake GitLab API from phase 5, with a token and a base
  URL. A project whose origin is on that host gets provider `gitlab` and opens merge requests as
  tasks.
- The browser button matches `https://gitlab.example.test/group/api/-/merge_requests/3` after the
  person grants the extension that site.
- Disconnect, and the host has no claim. The project keeps its stored provider and its tasks.
- A loaded plugin that claims `github.com` loses to GitHub, and the Node logs a warning.
- A plugin without `selfHosted` gets an error from `claim`.

## Risks

A claim is a trust decision. A plugin that claims a host receives the paths of the projects on it.
Loaded plugins already need `projects:read` to declare a code host, so the trust prompt covers it.
Name runtime claims in that prompt's text, so a person knows the list can grow.
