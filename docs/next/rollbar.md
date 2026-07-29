# Rollbar Source and pane — validation record

**Status:** implementation shipped. The durable contract is in
[integrations.md](../integrations.md), [panes.md](../panes.md),
[security.md](../security.md), and [caching.md](../caching.md).

## Shipped shape

- The Rollbar Source is a two-column master/detail view over workspace-mapped projects.
- The reusable `RollbarItemPanel` powers both the Source and a task pane. Summary, metadata,
  occurrence history, and selected occurrence use separate lazy query/cache keys.
- Provider-owned `issues` summaries and `issue_resources` children keep list freshness independent
  from detail/occurrence freshness. Each resource has explicit TTL/page/size budgets.
- A task may link several Rollbar items; complete `ExternalRef` data preserves project/item
  identity across multiple connections.
- Occurrences are normalized by an allowlist with string/frame/trace/total byte caps. Raw headers,
  cookies, query values, bodies, IPs, locals, custom/extra data, and raw JSON never persist or
  render. Truncation is explicit.
- Refresh acts on the active resource only. A detail read cannot make an item appear in the active
  list, and list refresh does not make stale detail fresh.

## Remaining live-contract spike

Before extending Rollbar behavior, validate against at least one real account/project:

1. Confirm active-item pagination, status filters, project scoping, and rate-limit headers.
2. Confirm item detail fields and deleted/resolved item behavior.
3. Confirm occurrence-list identifiers and individual occurrence payload locations across the
   account's SDK/language mix.
4. Verify comment/triage capability availability before exposing mutations; do not infer plan
   support from documentation alone.
5. Capture only sanitized field-shape notes. Never commit real occurrence fixtures, access tokens,
   payloads, person data, URLs, or stack content.

Any upstream mismatch should be fixed in the provider codec/normalizer with synthetic regression
tests. Do not add a generic raw-JSON escape hatch.

## Manual interaction/privacy QA

- Map/unmap several projects and confirm lists cannot bleed between workspaces/connections.
- Open Source and task variants; switch items/tabs/occurrences under slow and failed responses.
- Confirm resolved-but-linked detail remains available without polluting the active list.
- Exercise maximum-sized messages/traces and verify truncation indicators and layout.
- Inspect renderer/network/log output to confirm dropped fields never cross the server boundary.
- Test refresh, 401/403/404/429/5xx envelopes, reconnect, and offline cached reads.

Source: `apps/desktop/src/plugins/rollbar/{client,server,shared}/` and the external-item provider
runtime under `apps/desktop/src/core/server/integrations/`.
