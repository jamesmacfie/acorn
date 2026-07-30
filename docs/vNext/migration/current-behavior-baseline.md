# Current behavior baseline

**Status:** Normative parity input<br>
**Requirement prefix:** `MIG`

This document fixes the V1 behavior that V2 must reproduce for a fresh installation. It is not a
requirement to retain V1 modules, schemas, routes, data, or implementation techniques.

## V1 runtime

V1 is a single-user macOS Electron application. Electron main supervises an Electron-free Node
utility process, which owns the Hono server, SQLite, WebSocket hub, PTYs, worktrees, agents,
workflows, Docker, database pools, provider calls, and reconciliation. Electron main owns the
window, `WebContentsView`, safe storage, dialogs, navigation policy, and process supervision.

The renderer and API share `http://127.0.0.1:4317`. Browser requests use an encrypted same-origin
cookie; an optional second loopback listener exposes `/api/v1` bearer automation. Plugins are
statically imported from one TypeScript package and share core services, databases, and process
authority.

`MIG-001` V2 MUST preserve the useful Electron-free service boundary while replacing the loopback,
single-origin, static-composition assumptions with the Node contracts.

`MIG-002` Folder names such as `main` MUST NOT determine target process ownership. Code is classified
by actual dependencies: domain engines belong to the Node; only native window/OS adapters belong to
Electron main.

## Product hierarchy

The parity hierarchy is:

```text
Fleet (new in V2)
  Node
    Workspace (named group of repositories)
      Agent Center
      Task (repository + branch + worktree)
        Ordered/resizable panes
        Terminal drawer
        Agent pane and activity sidebar
```

`MIG-003` Existing local navigation MUST remain valid when the Fleet and Node dimensions are added.
Selecting a cached remote resource MUST visibly retain its Node origin.

## Required parity surfaces

| Surface | V1 behavior V2 must retain |
| --- | --- |
| Workspace/Task | Workspace identity, repo membership, task create/archive, worktree association, task links |
| TabRail/panes | Ordered/resizable/pinned panes, pane recipes, keep-alive behavior, keyboard access |
| GitHub | Repository/PR browsing, mirror caching, review diff, checks, comments, threads, labels, review/merge lifecycle |
| Changes | Staged/unstaged diff, stage/unstage/discard, commit/push, inline review notes |
| Notes/Context/Memory | Scoped Markdown, inclusion, context selection/budget, proposals and human-gated memory |
| Editor/Search | File tree, tabs, Monaco editing, autosave safety, reveal, finder, ripgrep search |
| Database | Schema/data browser, saved queries, SQL editor, DML, generated SQL |
| Docker | Source/pane, matching, status, logs/stats, actions, exec terminal, archive teardown |
| HTTP | Request collections, variables/secrets, cURL, send, response viewer |
| Linear/Rollbar | Multiple connections, source browsing, task linking/promotion, provider-specific detail |
| Preview | Task browser view, URL/config/rules, lifecycle, navigation controls, browser tools |
| Terminal | PTY/tmux sessions, profiles, reattach/snapshot, worktrees, run targets, cancellation |
| Agents | Managed sessions, turns, tools, permissions/questions, artifacts, attention, usage, import/export |
| Workflows | Definitions, durable run/step state, branching, joins, gates, budgets, cancellation, restart |
| Settings/onboarding | First-run workspace setup, integrations, model providers, tools, shortcuts, appearance, API replacement notice |
| Command model | Palette, global/task commands, default and overridden chords, contextual availability |

`MIG-004` “Behavioral parity” includes failure and confirmation behavior, not only successful output.
Destructive actions, dirty editors, active terminals, setup failures, stale caches, offline Nodes,
agent attention, and workflow gates MUST retain visible, recoverable states.

`MIG-005` “Visual parity” means the existing information hierarchy, pane purposes, interaction
density, and keyboard paths remain recognizable. V2 MAY adapt controls required for explicit Node
identity, capability absence, pairing, and plugin lifecycle.

## V1 event and API facts

V1 has three distinct event surfaces: six typed in-renderer events; an internal renderer WebSocket
with terminal, task, workflow, and agent frames; and `/api/v1` public events backed by a volatile
10,000-event/15-minute ring.

`MIG-006` V2 MUST replace these with one durable Node event contract. V1 event sequence values and
subscriptions are not imported.

`MIG-007` V1 HTTP paths and bearer tokens are not compatibility requirements. Current behavior is
mapped to V2 queries, commands, streams, and events by plugin specifications.

## V1 data facts

V1 uses one central SQLite schema for GitHub mirrors, product state, plugin data, API tokens, and
credentials, plus IndexedDB and on-disk blobs/files/worktrees. Some entities are GitHub-identity
scoped; others assume a single machine-global user.

`MIG-008` V2 MUST NOT copy that central schema into a “core” database. Data ownership is reassigned
to core or an individual plugin before implementation.

`MIG-009` V1 operational data is not imported. The V1 data root remains the rollback mechanism.

## Evidence

Parity is assessed against V1 documentation, source behavior, tests, and manual desktop scenarios.
Where prose and tested behavior disagree, the implementation and tests are the baseline unless the
V2 decision ledger deliberately changes the behavior.

The [V1 surface disposition ledger](./v1-surface-disposition-ledger.md) is the mechanical inventory
used to prove that every shipped route, public operation, event channel, table and registered
Client contribution has a target or explicit removal.
