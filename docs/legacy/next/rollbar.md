# Rollbar validation notes

Rollbar is shipped as a read-focused provider source and task pane. Its current contract is in
[integrations.md](../integrations.md), [security.md](../security.md), and
[api-reference.md](../api-reference.md).

Release validation should exercise multiple connections, partial list failures, item/detail/
occurrence freshness, task promotion, permalink behavior, and the privacy allowlist. Raw occurrence
payloads must never be persisted or rendered.
