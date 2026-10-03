# More descriptors

This page covers the descriptors that feed agents, other plugins, the scheduler, and the appearance
picker: agent contexts, reference resolvers, typed data sources, schedules, node actions, and themes.
It's part of the [plugin reference](../plugins.md). Rail sources, content links, and routes are in
[descriptors](./descriptors.md).

## Agent contexts

An `agentContexts` entry names two routes, `options` (GET) and `capture` (POST), and puts a row in
the agent composer's context picker:

```json
{
  "contributions": {
    "agentContexts": [{
      "id": "http-requests",
      "label": "HTTP requests",
      "description": "Saved requests and their latest responses",
      "options": "/v1/p/http/agent-context/options",
      "capture": "/v1/p/http/agent-context/capture"
    }]
  }
}
```

`options` answers `[{ id, label, description?, defaultSelected? }]`. `capture` receives
`{ taskId, workspaceId?, optionIds? }` and answers
`[{ contextId, label, content, resourceId?, provenance?, deepLink?, freshness?, sensitivity? }]`
(`@acorn/protocol/agentContext.ts`). The capture answer ends up inside a model's prompt, so the host
parses it against a schema. The host stamps `source` from the plugin id, stamps the capture time, and
measures the bytes itself, so the shared 512 KiB `MAX_AGENT_CONTEXT_BYTES` ceiling can't be talked
past. An over-budget capture is refused whole, never trimmed. The compiled contract's synchronous
`revision?()` has no manifest form, because a descriptor answers across a fetch.

## Reference resolvers

A `refResolvers` entry answers what another plugin's surface should draw for identifiers of this
plugin's items. Recognition is `contentLinks`, and the host scans text for every recognizer at once
(`scanContentRefs`). The resolver is the enrichment half:

```json
{ "contributions": { "refResolvers": [{ "id": "linear-refs", "kind": "linear.issue", "resolve": "/v1/p/linear/issues" }] } }
```

The host posts `{ identifiers }`, capped in count, and parses the answer as
`[{ identifier, label, state?: { name, color, kind }, url? }]` (`@acorn/protocol/refResolvers.ts`).
`providerId` isn't in the body. The host stamps it from the plugin whose route answered, so a row
can't publish another provider's items. A consumer addresses a resolver by provider, never by route
(`refResolutionsOptions` in `client-core/host/registries/panes/refResolvers.ts`), with five minutes of
staleness for every provider.

Keep the answer to a label and a state chip. Every field added here is a field every provider's
answer is drawn with. The route spends provider credentials on a cache miss and sits behind
`requireProviderAccess`, and the identifier cap is the budget.

## Typed data sources

A `dataSources` entry extends descriptors from scalar facts to structured records. The plugin
declares its schema, query capabilities, identity scope, and Node-owned handler. The host binds
provenance, validates responses, and supplies the shared query editor and dashboard views. Dynamic
catalogues use `dataSourceDiscoveries`. Compiled plugins call `ctx.dataSources.register` or
`ctx.dataSources.discover`, and both carriers land in one Node registry, which owns cleanup on reload
and disable. Node consumers, including unattended dashboard sampling, call that registry. See
[typed data sources](../data-sources.md).

## Schedules

A `schedules` entry acts when nobody is watching. It names a route in the plugin's own namespace, a
cadence ([schedules](../schedules.md)), and an optional timeout in seconds. The Node's scheduler posts
`{ scheduleId }` to that route on that cadence with no client open, and reads only ok or error from
the answer. A plugin may declare at most four.

```json
{
  "contributions": {
    "schedules": [{
      "id": "refresh-mirror",
      "name": "Refresh issue mirror",
      "run": "/v1/p/linear/schedules/refresh-mirror",
      "cadence": { "every": 600 },
      "timeout": 120
    }]
  }
}
```

A manifest declaring one must declare a `node` half, or the schedule would hit a 404 forever. The
plugin cadence floor is 300 seconds, enforced from the registry key. Below that, a schedule is a
poll, and polling is a client's job.

A schedule joins the trust dialog's **Declared** group, such as "Run *Refresh issue mirror* on the node
every 10 minutes, with nobody watching", and is recorded with the decision. A version that moves from
daily to every five minutes reads as newly requested.

A compiled plugin registers in `init` with
`ctx.schedules.register({ scheduleId, name, cadence, timeout?, run })`, where `run` takes the run's
`AbortSignal`. Both carriers land under the same `<pluginId>:<scheduleId>` key, and the host owns
removal, so a `setInterval` in plugin node code is a review flag. [Plugin
schedules](../schedules/plugin-schedules.md) has the lifecycle table.

A manifest-declared schedule on a development install needs the package rebuilt before the Node sees
it. Reconciliation doesn't rebuild it.

## Node actions

Node actions have no `ctx` member. An action a person may put on a schedule is declared in the
manifest as a command whose verb is `runNodeAction`, and the host replays it through
`HostPluginContext` in `server/pluginHost/types.ts`. Declaring nothing means none of the plugin's
actions can be scheduled. An action with no `risk` is treated as `execute`, so leaving it out fails
safe.

## Themes

A `themes` entry is a color theme with no route, bundle, or CSS: a map of the 22 palette tokens plus a
`dark` flag. The host validates the map and generates the
`:root[data-theme="plugin:<id>:<theme>"]` block itself, so nothing a plugin wrote is parsed as a
stylesheet. A theme can't express shape, density, or layout, can't set a derived token, and can't set
the self-description tokens the host writes from `dark`. The Node validates at parse time and the
client again before generating CSS.

```json
{
  "contributions": {
    "themes": [{
      "id": "nightfall",
      "label": "Nightfall",
      "dark": true,
      "tokens": { "--bg": "#12121a", "--text": "#dcd7ff", "…": "…" }
    }]
  }
}
```

[Plugin themes](../ui-design/appearance.md#plugin-themes) owns the token contract and what happens
to a saved preference when the owning plugin goes away. A client-only package can also declare
`contributions.styles` ([style packs](../plugin-authoring/ui-contributions.md#style-packs)).
