# Future work

This directory now contains only forward-looking design constraints and explicitly deferred work.
The completed implementation plan, phase guides, review inventories, and parity checklist have been
removed; current behavior is documented in the parent [`docs/`](../) tree.

| Document | Remaining forward-looking scope |
| --- | --- |
| [self-improvement.md](./self-improvement.md) | Annotation-only self-improvement seams; no implementation is scheduled |
| [performance.md](./performance.md) | Remaining measurement, retention, and scaling work |
| [security.md](./security.md) | The unbuilt repo-config trust gate (see [next-review.md](../next-review.md) §1.1) plus future principal kinds, relays, webhooks, and control channels |
| [rollbar.md](./rollbar.md) | Rollbar master/detail Source and task pane: API capability map, privacy-safe occurrence detail, and phased implementation plan |
| [context-ui.md](./context-ui.md) | Agent-context UX rework: Manifest pane (persisted selection, preview, sizes, session picker, staleness, inline memory) + scratchpad-first Notes pane, with phased plan |
| [chat/](./chat/) | Workspace-scoped multi-provider chat plugin: persistence, providers, streaming, attachments, UI, security, and implementation plan |

Shipped contracts belong in durable docs such as [plugins.md](../plugins.md),
[integrations.md](../integrations.md), [state.md](../state.md), [security.md](../security.md),
[testing.md](../testing.md), [workflows.md](../workflows.md), and
[notes-and-memory.md](../notes-and-memory.md). If a deferred item ships, move its lasting contract
into the relevant durable document and remove the completed proposal from this directory.
