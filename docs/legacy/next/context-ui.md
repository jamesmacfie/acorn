# Context UI follow-ups

The Context pane is shipped. Its current behavior is documented in [features.md](../features.md),
[agent-tools.md](../agent-tools.md), and [panes.md](../panes.md). This file contains only manual QA
and possible follow-ups.

- Verify slow section providers resolve independently and preserve sibling sections.
- Verify narrow layouts keep budgets, stale state, and sync actions readable.
- Verify task switching and Node switching dispose old section state.
- Verify agent sync uses an immutable snapshot and surfaces provider/task failures.
