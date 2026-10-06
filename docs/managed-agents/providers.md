# Providers and plan usage

This page covers how the Node finds which harnesses are installed and signed in, and how it reads
each harness's plan usage. The usage collectors are in `plugins/agents/src/server/usage/`.

## Providers

`GET /v1/p/agents/providers` lists the harnesses, whether each is installed and signed in, and the
configuration options each advertises. The workflow editor reads the same route, so its model and
reasoning lists match the Agent pane's.

Model and effort choices come from the newest connected session for each provider among the 50
latest active sessions. They are read separately from the availability cache, so connecting a session
makes its choices available on the next provider request. Before a harness has advertised any choices,
the workflow editor asks you to open a session on it once. Execution validates requested options
against the new session's own advertised values.

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
the full refresh action check every harness. The refresh icon beside the harness name probes only
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

Codex's token counters are cumulative for each thread. Input includes cache reads and cache writes;
output includes reasoning tokens. The estimate subtracts consecutive turn snapshots, then prices
ordinary input, cache reads, cache writes, and output separately. Repeated snapshots add no cost.
The one-shot `codex exec --json` capture preserves the same cache-write count.

The catalog uses standard short-context API rates. GPT-5.6 and later charge cache writes at 1.25
times the input rate; GPT-5.5 uses the input rate. See [OpenAI's prompt caching
guide](https://developers.openai.com/api/docs/guides/prompt-caching). Catalog matches accept base
model IDs and dated snapshots. Other variants need an exact-model override.

The badge is an API-equivalent estimate of the root thread's tokens. It excludes subagent threads,
tool fees, service-tier premiums, regional premiums, and long-context premiums. A turn's captured
model sets its price, so model changes within that turn cannot be priced separately. Codex's
`last.totalTokens` describes the latest context, which can be recomputed after compaction; it is not
a billing delta. The per-turn snapshot also cannot reveal whether every request exceeded a pricing
threshold. For example, [GPT-6.1 Sol's pricing](https://developers.openai.com/api/docs/models/gpt-6.1-sol)
doubles input and cache rates and multiplies output by 1.5 when a request exceeds 272,000 input tokens.
Plan usage, credits, and negotiated billing can differ from the API-equivalent estimate.

Native Codex forks inherit their source thread's usage snapshot. Acorn creates an empty turn ledger
for the fork, so its estimate includes inherited tokens when the first turn reports cumulative usage.
Summing the source and fork badges can therefore count the source tokens twice.
