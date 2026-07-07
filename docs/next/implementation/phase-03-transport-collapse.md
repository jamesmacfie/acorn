# Phase 3 — Transport collapse

**Status:** planned · **Depends on:** Phases 0 and 1 recommended · **Gated by:**
smoke suite and transport performance baseline · **Primary docs:**
[inventories](../inventories.md) §1, [security](../security.md) §3 and §7,
[performance](../performance.md) §3.3, [feature parity](../feature-parity.md).

## Goal

Collapse request/response IPC onto loopback HTTP and move terminal/workflow
streams to one authenticated WebSocket. The residue IPC surface should contain
only true Electron capabilities.

This phase turns three transport stories into one:

- HTTP route contract in `shared/api.ts`;
- authenticated WS for streams;
- minimal IPC residue for native handles/dialogs/main-to-window pings.

## Architectural Context

Current IPC contracts are hand-synced across preload, renderer client
interfaces, and main handlers. Phase 3 replaces that drift surface with typed
HTTP routes and route tests.

Target residue:

- `browser:bind`;
- `term:repoPath:pick`;
- `acorn:close-pane`;
- platform/capability probes.

All former request/response channels from [inventories](../inventories.md) §1a
must become routes. Stream channels from §1b become WS frames.

## Implementation Plan

1. Establish route/client/test convention.

   - Route builders and response types live in `shared/api.ts`.
   - Route handlers construct responses with `satisfies`.
   - Clients call through existing `readJson` / `writeJson`.
   - Protected routes use `requireUser`.
   - Bodies that write files, spawn processes, or execute SQL get zod schemas
     and malformed-body tests.

2. Migrate request/response domains one at a time.

   Suggested order:

   1. `search` (1 channel)
   2. `editor` (5)
   3. `run` (5)
   4. `workflow` (5)
   5. knowledge (11)
   6. local-git (11)
   7. `database` (9)
   8. terminal control (18)

   Task-scoped channels become `/api/tasks/:id/<domain>/<verb>`.
   Machine-scoped channels become `/api/<domain>/...`.

3. Add security-sensitive route tests.

   Editor, git, search, and database are not bookkeeping migrations. They write
   files, run commands, or execute SQL. Add tests for path traversal, symlink
   escape, missing worktree, stale buffer, identifier validation, connection URL
   non-persistence, and pool teardown as applicable.

4. Add the WebSocket transport.

   One endpoint on the loopback origin carries:

   - `term:out`;
   - `term:input`;
   - attach/detach;
   - `term:status`;
   - `workflow:notice`;
   - reserved `workflow:step:event`.

   Upgrade auth requires Host guard, session cookie, exact-Origin check, and
   403 on failure. Coalesce PTY output into roughly 16 ms frames and guarantee
   attach replay arrives before live frames.

5. Delete migrated preload blocks and renderer interfaces.

   Delete each domain's preload block only after the replacement route and
   tests are proven. Keep domain PRs revertable until that cleanup commit.

6. State the client capability contract.

   Every migrated pane/tool/surface declares whether it needs no bridge,
   desktop bridge generally, or a named IPC residue capability. Server-backed
   surfaces must work in `dev:node`; desktop-only surfaces hide or degrade with
   a visible reason.

## Slice Order

1. Pattern PR with `search`.
2. `editor` migration to exercise file/path validation.
3. `run` and `workflow`.
4. Knowledge, local-git, and database.
5. Terminal control.
6. WebSocket stream migration.
7. Preload residue cleanup and `dev:node` capability pass.

## Acceptance Criteria

- Preload exposes only the named residue and capability probes.
- Every former request/response IPC channel has a typed HTTP route.
- Every former stream channel has a WS frame.
- Route bodies at untrusted/write/execute boundaries are validated.
- Terminal streaming has no visible regression under a busy TUI.
- `dev:node` has an explicit capability map and does not crash on missing
  Electron bridge APIs.
- Replay ordering on terminal attach is deterministic.

## Verification

- `pnpm lint`
- `pnpm test`
- Smoke suite, especially terminal echo S4.
- Keystroke-echo and busy-TUI marks compared with baseline.
- Live pass per migrated pane.
- Plain-browser `dev:node` pass for every surface that no longer needs Electron.
- Security route tests from this file and [security](../security.md) §7.

## References

- [inventories.md](../inventories.md) §1a, §1b, §1c, §1d.
- [review.md](../review.md) §3.
- [security.md](../security.md) §3 and §7.
- [performance.md](../performance.md) §3.3.
- [agent-runtime.md](../agent-runtime.md) §3.2.
- [feature-parity.md](../feature-parity.md) §7, §14, §17.
- [docs-overhaul.md](../docs-overhaul.md) §2 for API, Electron, auth, and
  local-development docs.
