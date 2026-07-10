# Future work

This directory now contains only forward-looking design constraints and explicitly deferred work.
The completed implementation plan, phase guides, review inventories, and parity checklist have been
removed; current behavior is documented in the parent [`docs/`](../) tree.

| Document | Remaining forward-looking scope |
| --- | --- |
| [agent-runtime.md](./agent-runtime.md) | Typed recovery actions, cross-task runtime visibility, and the deliberately bounded workflow ceiling |
| [agent-runtime-influences.md](./agent-runtime-influences.md) | Rationale for deferred recovery outcomes and rejected control-plane machinery |
| [self-improvement.md](./self-improvement.md) | Annotation-only self-improvement seams; no implementation is scheduled |
| [memory.md](./memory.md) | Periodic consolidation, richer decay handling, and possible future scopes |
| [integrations.md](./integrations.md) | OAuth refresh, webhooks/background ingestion, dynamic uninstall, and multi-secret providers |
| [performance.md](./performance.md) | Remaining measurement, retention, and scaling work |
| [ux.md](./ux.md) | Deferred pane-management interactions and other additive UX surfaces |
| [extensibility.md](./extensibility.md) | Anticipated additive surfaces such as cross-workspace dashboards |
| [contribution-points.md](./contribution-points.md) | Forward extension constraints and examples for future contributors |
| [state-and-policies.md](./state-and-policies.md) | Policy seams that become relevant as new background or dashboard consumers arrive |
| [security.md](./security.md) | Constraints for future principal kinds, relays, webhooks, and control channels |
| [api/](./api/) | Bearer-authenticated public HTTP automation API design, schemas, plugin contract, command catalog, and implementation plan |
| [chat/](./chat/) | Workspace-scoped multi-provider chat plugin: persistence, providers, streaming, attachments, UI, security, and implementation plan |

Shipped contracts belong in durable docs such as [plugins.md](../plugins.md),
[integrations.md](../integrations.md), [state.md](../state.md), [security.md](../security.md),
[testing.md](../testing.md), [workflows.md](../workflows.md), and
[notes-and-memory.md](../notes-and-memory.md). If a deferred item ships, move its lasting contract
into the relevant durable document and remove the completed proposal from this directory.
