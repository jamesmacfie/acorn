# Providers and plan usage

This page covers how the Node finds which harnesses are installed and signed in, and how it reads
each harness's plan usage. The usage collectors are in `plugins/agents/src/server/usage/`.

## Providers

`GET /v1/p/agents/providers` lists the harnesses, whether each is installed and signed in, and the
configuration options each advertises. The workflow editor reads the same route, so its model and
reasoning lists match the Agent pane's.

A probe starts each harness's CLI, which took 211 ms typically and up to 5 seconds, so the Node serves
the last answer from memory (`ManagedAgentEngine.providers` in `runtimeEngine.ts`). Once that answer
is 30 seconds old, the next read still gets it, and one probe runs behind the read to replace it.
Callers that arrive meanwhile share that probe. Three reads wait for a fresh probe:

- The first read after boot.
- A read after a harness was added, removed, or had its factory replaced.
- `?force=true`, which the **New** menu's **Refresh** button sends.

A session start or a delegated spawn that the cached answer would refuse probes once more first, so
installing or signing in to a CLI needs no Node restart. Custom agents, MCP servers, and session
defaults aren't part of the answer, so editing them drops nothing.

Ordinary misses join one probe wave per registry generation. A forced refresh starts its own wave,
and only the latest wave from the current generation can publish. A rejected probe returns that
provider's diagnostic descriptor. Discovery describes availability. Provider startup still negotiates
readiness and configuration.

The client reads the list through the shared `['agents', 'providers']` query
(`plugins/agents/src/client/providersClient.ts`), fresh for a minute.

## Plan usage

Plan usage is per harness and per account. The built-in CLI probes and a contributed harness's
`probes.usage` route feed one registry (`collectors.ts`), and a harness with no collector shows no
usage section. The Node probes availability and usage on bounded intervals. Five-minute polling and
the full refresh action check every harness. The refresh icon beside one harness's usage probes only
that harness.

Each quota row draws a bar under its sentence, colored by the same reading as the dot beside the
harness name. A small triangle marks where steady spending would have left the fill by now, because
20% left is fine an hour into a week and alarming an hour into a five-hour session. The mark needs the
window length, so a quota carries `windowSeconds`. A collector that can't say leaves it null, and the
bar draws without the mark. A contributed harness has no way to declare a window. A reset further out
than the whole window also drops the mark, because then the window isn't the one acorn assumed.

`AgentUsageSection.tsx` draws the list. A provider's usage is account-level, so the Node collects it
once for every client.

## Pricing

Usage and pricing show in the Agent pane. Settings > Limits and cost holds the built-in Claude and
Codex price catalogs and exact-model overrides, under the concurrency ceilings. Overrides are local
preferences. The cost badge in the session header comes from the bundled `agent-cost` plugin
([client surfaces](./client-surfaces.md#the-agent-pane)).
