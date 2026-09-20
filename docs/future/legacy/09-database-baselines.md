# Ticket 09: Fresh database baselines

Date: 2026-09-21. Status: not started. Prerequisites: 03, 04, 05.
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
