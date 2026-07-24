# Plans

| Plan | Status | Priority | Effort | Risk | Planned at |
| --- | --- | --- | --- | --- | --- |
| [001 — Add local Claude and Codex usage details to the Agents surface](./001-add-agent-usage-details.md) | Implemented | P1 | L | Medium | `d39f779` |
| [001 — Add a shared model-provider foundation](./001-add-shared-model-provider-foundation.md) | Implemented | P1 | L | Medium | `d39f779` |

The plan numbers came from independent planning passes; filenames are the
authoritative identifiers. Both plans are self-contained and have no prerequisite
plan.

## Agent usage decisions

- Extending the core delegated rail tooltip with structured colored rows was
  rejected for the first version because the existing plain `data-tip-sub`
  contract renders the requested health icons and percentages without increasing
  the core UI blast radius.
- Storing provider usage in SQLite or IndexedDB was rejected because this is an
  ephemeral account-level read model; an in-memory TTL plus last-good snapshot is
  enough and avoids a schema and migration lifecycle.
- Direct Claude/Codex usage APIs were rejected because they would make Acorn
  responsible for OAuth credential reads, refreshes, and writes. The installed
  CLIs and Claude's local logs provide the requested first version without new
  credentials.
- Putting usage collectors in the Claude/Codex profile plugins was rejected
  because usage is a shared Agents-surface concern. The collectors can identify
  the two commands without expanding the agent-profile contract.
