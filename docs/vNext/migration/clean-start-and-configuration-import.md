# Clean start and configuration import

**Status:** Normative<br>
**Requirement prefix:** `MIG`

## Boundary

V2 uses a separate data root and treats V1 as an independent application installation.

`MIG-040` Starting V2 MUST NOT open, migrate, rewrite, chmod, compact, or delete the V1 SQLite
database, IndexedDB, blobs, worktrees, configuration files, credentials, or caches.

`MIG-041` V2 MUST choose its data root before starting listeners, installing plugins, or creating
identity material. If the path resolves inside the V1 root, startup fails closed.

## Importable configuration

The optional importer may read:

- workspace name, color, icon, and ordering;
- repository owner/name and workspace membership;
- local checkout path;
- repository setup/dev/restart/teardown/database script text;
- declarative preview and Docker matching configuration; and
- repository branch-prefix configuration.

`MIG-042` Every imported local path MUST be re-resolved, traversal-checked, and confirmed by the
owner before use. Import does not confer executable-config trust.

`MIG-043` Executable configuration MUST enter V2 as untrusted and MUST pass the V2 exact-snapshot
review ceremony before execution.

## Excluded data

The importer MUST NOT read or copy:

- sessions, cookies, GitHub tokens, integration credentials, secrets, HTTP variables, or API tokens;
- tasks, worktree ownership, terminal sessions/output, agent sessions/turns/events, workflows/runs,
  command executions, or approvals;
- notes, memory files/indexes/proposals, review notes, saved queries, HTTP requests, plugin stores,
  provider mirrors, GitHub mirrors, blobs, cache freshness, or event cursors;
- appearance, layout, pane, editor-tab, shortcut, or other presentation preferences; or
- plugin installation, permission, setup, health, update, or quarantine state.

`MIG-044` Excluded data MUST NOT be copied even when a plugin has a compatible V2 representation.
The clean-start decision is a product boundary, not an engineering-effort optimization.

## Import flow

1. Electron detects a V1 data root and offers **Import workspace configuration**.
2. The importer opens eligible V1 configuration read-only.
3. It builds a bounded preview with no secrets or operational records.
4. The owner selects workspaces/repositories and confirms checkout paths.
5. V2 writes ordinary core resources through idempotent commands.
6. Plugin-specific declarative configuration is written only after that plugin is installed.
7. The importer records source fingerprint, selected fields, resulting resource URIs, and completion
   in the V2 audit log.

`MIG-045` Import MUST be resumable and idempotent. Re-running the same source selection updates only
the importer-owned configuration fields and MUST NOT duplicate workspaces/repositories.

`MIG-046` Import failure MUST leave committed resources valid and identify the exact remaining item.
It MUST NOT roll back unrelated successful workspace imports.

## Return to V1

`MIG-047` “Rollback” means exit V2 and launch V1 against its untouched data. V2 MUST NOT write data
back to V1 or claim bidirectional compatibility.

`ACCEPT-MIG-001` A byte-for-byte hash of every V1 file before and after V2 import is unchanged.

`ACCEPT-MIG-002` A V1 repository with executable configuration is present in V2 but cannot execute
until the new trust snapshot is approved.

`ACCEPT-MIG-003` Repeating an interrupted import produces one workspace/repository resource per
selected V1 identity.
