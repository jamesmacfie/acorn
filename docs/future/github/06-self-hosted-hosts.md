# Phase 6: let a code host claim hosts at runtime

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
