# Ticket 09: Fresh database baselines

Date: 2026-09-21. Status: implemented 2026-09-23. Prerequisites: 03, 04, 05.
Read [context](./context.md), F09/F10 in [findings](./findings.md), and
[reset policy](./reset-and-versioning.md).

## Outcome

Each table-owning package creates its final schema directly, without replaying discarded historical
transformations. Credential names describe their actual value.

## Work

- Rename the encrypted integration credential property to `encryptedCredentials` and physical column
  to `encrypted_credentials`. Update secrets adapters, provider contexts, backup redaction, tests, and
  declarations together. Do not expose the value on public connection responses.
- Remove schema members whose sole owners disappeared in tickets 03–05. Retain present workflow
  admissions, publication revisions, application receipts, and durable execution records.
- Generate one initial migration per discovered `drizzle.config.ts` chain. Replace journals/snapshots
  consistently and regenerate bundle inputs from those owners. Keep Drizzle metadata's own format version.
- Preserve constraints, indexes, foreign keys, defaults, and explicit seed operations. Compare the
  resulting fresh schema against the post-removal model, not against a database containing legacy tables.
- Keep future migration machinery and history-hash rejection. A prior database must fail with a clear
  reset instruction; do not automatically rewrite it or silently start an empty replacement.
- Remove the workflow-v2 transition command/script/tests when the general reset tooling covers its
  safety requirements. Historical programme notes may retain the record, clearly marked as superseded.

## Acceptance

Run `pnpm db:check`, database schema/constraint tests, and every table-owning plugin's storage tests.
Verify fresh compiled and loaded boot, mismatched historical journals, and bundled/standalone migration
discovery. Inspect indexes and foreign-key checks, and confirm backups exclude or redact credentials
as before. Run `pnpm lint`. Use temporary databases only.

## Verify before building

Re-enumerate migration chains; the review found 11, but do not hard-code that count into generation.
Do not reset a real database to make tests pass or remove the migration integrity guard.

## Implementation and evidence

- Discovered 11 chains from `drizzle.config.ts` and generated one `0000` SQL file, journal entry,
  and snapshot for each. The initial SQL retains Agents' FTS table and three triggers and Memory's
  FTS table, which Drizzle cannot describe. Removed the tests that replayed discarded Findings and
  Workflow data transformations. No real data root was reset.
- Renamed the integration row property to `encryptedCredentials` and its SQLite column to
  `encrypted_credentials` throughout credential use, provider contexts, fixtures, and backup
  redaction. Public connection responses still omit the encrypted value. Fresh workflow runs now
  require `root_run_id`; root runs store their own ID. Kept publication, admission, processing,
  receipt, and recovery tables in their owning chains.
- Core and plugin opens share an applied-history check before Drizzle runs. It rejects changed SQL,
  removed or reordered entries, and existing tables with absent or empty history, with a recoverable
  reset instruction. Temporary old-core and old-plugin fixtures show rejection without schema writes.
- `pnpm db:check` replayed all 11 baselines. Fresh temporary SQLite inspection found 91 declared
  tables and 89 named indexes; column nullability, defaults, CHECK constraints, integrity, and
  foreign-key checks matched the generated snapshots. Agents FTS tests passed 2/2; Memory FTS
  passed 1/1. Core backup and migration-history tests passed 19/19 after the final guard tests.
- All table-owning plugin suites passed: Browser 8 (1 skipped), Changes 217, Database 72,
  Findings 44, HTTP 113, Memory 35, Agents 650, GitHub 166, and Workflows 479. Terminal passed
  118/119; its live PTY test could not call `posix_spawnp` in this environment. Loaded HTTP boot,
  update migration, and broken-chain containment passed 5/5.
- `pnpm pack:node` built the standalone artifact and staged all 11 chains. An unpacked standalone
  Node booted and drained against a temporary data root; its core database had one applied baseline
  and the renamed credential column. The packaging check now includes the browser's `playwright-core`
  runtime dependency and ignores a template placeholder in a bundled error message.
- `pnpm lint` passed in all 34 lint tasks. The workflow-v2 transition script and tests were removed
  by ticket 01; the former programme record is marked superseded by the general recoverable reset.
- Architecture tests passed 64/65. The remaining failure is the existing palette host command
  invocation in `packages/client-core/src/host/palette/paletteView.ts`, outside this database ticket.
  `git diff --check` passed.
