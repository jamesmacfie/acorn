# Documentation review follow-up

Application changes identified during the September 11, 2026 documentation review. No application
code changes are part of this review.

## Isolate loaded node plugins

`packages/node-core/src/server/plugins/permissions.ts` limits the context but leaves plugins in the
Node process. A plugin can import `node:fs` and bypass core ownership. Follow the
[sandbox plan](./sandbox/README.md) to isolate execution and broker permitted operations.
Verify that a plugin cannot open core or another plugin's database directly.

## Verify migration history

`packages/node-core/src/server/plugins/migrations.ts` checks for a journal, not the immutability of
applied migrations. Add a comparison against applied migration metadata before an update or reload.
Test edited SQL and reordered journal entries against a database with applied migrations.
Preserve the database and fail the update with an actionable error.

## Check documentation anchors and examples

`tools/arch/docPaths.test.ts` checks target files but ignores heading fragments. Some API examples
also rely on review alone. Add heading validation and compile selected third-party examples outside
the workspace, following `packages/create-acorn-plugin/index.test.ts`.

## Reassess the editor's compiled dependency

`docs/first-party-plugins.md` still identifies an extraction decision after the CodeMirror migration.
Trace `EDITOR` and `SEARCH` consumers, measure a standalone bundle, and document the remaining host
requirements. Keep desktop and terminal document behavior behind the shared editor contract.
