# Context and Notes rework — implementation record

**Status:** shipped. Current behavior is authoritative in
[notes-and-memory.md](../notes-and-memory.md) and [panes.md](../panes.md).

The rework replaced a long assembled-text pane plus a bolted-on memory tray with two complementary
surfaces:

- **Context** is the manifest of what an agent will receive. It loads the complete contribution
  inventory, hides empty sections, persists per-task section selection, displays byte/budget
  indicators, expands item detail, jumps to owning panes, previews the exact assembled block, and
  syncs to a chosen running agent session. Per-session content fingerprints expose never synced,
  synced, and stale state.
- **Notes** is where context is written. It lands on a virtual task scratchpad, creates it on first
  input, and provides a collapsible/filterable Task/Workspace/Global library with per-scope create,
  rename/delete, include dots, provenance badges, and independently debounced title/body autosave.
- **MemorySection** now renders inside the Context memory section. Human-gated proposals and manual
  creation update the same inventory rather than living in a separate tray.

## Preserved invariants

- Notes remain file-backed and gitignored; memory files remain the durable truth with SQLite as a
  derived index.
- Agent note writes carry provenance; agent memory writes remain proposals only.
- Context assembly still comes from the server contribution registry and `formatContextBlock`; the
  local preview is derived from the same inventory/selection.
- Sending remains `after-ready`, so a busy agent is not interrupted mid-turn.
- Selection and pane intent are task-scoped. Switching tasks cannot leak note selection, context
  inclusion, or sync state.
- Size display uses UTF-8 bytes and descriptor budgets, not a misleading provider-specific token
  estimate.

## Remaining validation

- Exercise scratchpad creation, note switching, blur/unmount flush, and retained context→note
  intents under slow bridge responses.
- Verify long notes, many memories/proposals, absent integrations, and narrow pane widths visually.
- If Context gains item-level selection, extend the persisted selection contract deliberately;
  current selection is section-level and avoids a large, fragile per-item preference.

Source: `plugins/context/src/client/`,
`plugins/notes/src/client/`, and
`plugins/memory/src/client/MemorySection.tsx`.
