# Self-hosted code hosts

This page covers how a code host claims hosts while it runs, for a product people run on their own
servers. It's part of [code hosts](./code-hosts.md).

## Claim a host

A product people run on their own servers, such as GitLab, can't list every host in its manifest. Such
a code host declares `selfHosted: true` beside `hosts`, and claims each server's host while it runs:

```ts
const claim = ctx.codeHosts.claim('gitlab.example.com')
// Later, when the person disconnects that server:
claim.dispose()
```

A claim follows the same tie rules as a declared host, so a loaded plugin that claims `github.com`
loses to GitHub, and the Node logs a warning. `claim` throws for a plugin whose code host doesn't
declare `selfHosted`, and for a host that isn't a bare lowercase name. Core stores no claim. Every
claim goes when the plugin stops, so the plugin claims its hosts again at init from its own settings,
such as each connection's address. The claims live on the plugin's entry in
`packages/node-core/src/server/pluginHost/codeHosts.ts`. While nothing claims a host, each project on it keeps the provider
stored on it, as it does when its plugin is turned off.

Each claim changes which hosts the plugin holds, so the Node broadcasts `plugins:changed` and clients
read the projects and roster again. The trust prompt says a self-hosted code host can add hosts, and
that it receives the paths of the projects on them.

## Name every held host in a pattern

A browser handoff's `match` pattern or a content link's `match` can name `{codeHost}` as its host:

```json
"match": ["https://{codeHost}/{path+}/-/merge_requests/{number}"]
```

Core expands it into one pattern per host the plugin holds, declared or claimed, without a host another
plugin wins. Discovery expands handoff patterns on each read. Each roster row lists the plugin's hosts
as `codeHosts`, and the client expands content links from that and registers them again when it
changes. A host the content link grammar can't take, such as one with no dot, gets no pattern. A
plugin that holds no hosts matches nothing.
