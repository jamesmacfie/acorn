# Agent usage details — implemented

Agent usage is an account-level, ephemeral read model owned by the agents plugin. It is not persisted
in SQLite or IndexedDB. The Node/desktop runtime collects provider-local usage data through the
installed Claude and Codex tooling, normalizes it into a shared contract, caches the last good result
for a short TTL, and exposes it through the agents routes and Agent UI.

## Current behavior

- Claude usage is collected from the installed CLI/local records without adding a provider credential
  to acorn.
- Codex usage is collected through its app-server/rate-limit surface with a bounded fallback.
- Provider absence, unsupported plans, malformed output, and stale snapshots are represented
  explicitly; the UI does not invent zero usage.
- The Agent header shows quota health, reset information, detailed usage, and local pricing estimates.
- Pricing overrides are validated preferences. No usage row or prompt/response history is stored by
  this feature.
- Latest-request-wins guards prevent an older refresh from overwriting a newer snapshot.

## Ownership

Collectors live with the agents runtime. The client consumes the typed usage response and renders the
task Agent pane and related rail/palette surfaces. The feature uses the existing `/v2/p/agents/usage`,
`/refresh`, and `/pricing` routes; it is not a second provider credential or auth system.

## Constraints

Keep collection bounded, avoid logging provider output or credentials, preserve explicit unknown
states, and do not make usage a prerequisite for running a managed session. Detailed source behavior
is in `plugins/agents/src/main` and the usage route/tests.
