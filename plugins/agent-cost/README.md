# Agent session cost

This is a client-only loaded plugin. It contributes a remote tree to
`agents:session-header` and displays the current managed session's estimated US-dollar cost beside
the title.

The Agents plugin owns the session ledger and the user's model-price preferences. Its extension
point projects only JSON-safe session facts: provider, per-turn usage, the captured model price, and
whether successive counters are per-turn or cumulative. This plugin owns the product policy over
those facts:

- prefer a provider-reported USD cost;
- otherwise calculate an API-equivalent estimate from input, output, cache-read, and cache-write
  tokens;
- turn cumulative counters into deltas;
- show nothing when a model price is unknown or counters regress; and
- format the result as a compact `≈$…` badge when it is estimated.

The manifest requests no node, API, event, secret, process, or network permissions. Production code
imports only the published `acorn-plugin-sdk` and Solid. The point payload has a local structural type,
and the plugin imports no Agents, desktop, TUI, or Acorn client implementation. The directory can move
to another repository by changing workspace dependency versions to published versions; its source and
manifest do not need to change.

Build the same package Acorn bundles:

```sh
pnpm --filter @acorn/node build:plugin agent-cost -- --package-root /path/to/plugins
```
