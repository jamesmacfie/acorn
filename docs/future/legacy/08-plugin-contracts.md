# Ticket 08: Explicit plugin contracts

Date: 2026-09-21. Status: not started. Prerequisites: 06, 07.
Read [context](./context.md), F08 in [findings](./findings.md), and
[protocol/type decisions](./target-architecture.md#protocol-placement-and-public-types).

## Outcome

Plugin authors see one command representation, and a host method's synchronous or asynchronous
behaviour is checked alongside its public signature.

## Work

- Remove the manifest's palette alias and its conversion/validation/registration paths. Require an
  explicit command kind and use a discriminated command schema. Update built-in configs, shipped
  packages, scaffolds, examples, generated JSON schema, and published declarations together.
- Keep command grouping, search, settings, permission confinement, and the closed action vocabulary.
  Missing kind and the removed palette collection fail clearly rather than silently disappearing as
  tolerated unknown fields. Add an explicit obsolete-field diagnostic before generic unknown-field handling.
- Replace implicit regex/default classification for known host context methods with an explicit call-mode
  table checked against the callable public context paths. Unknown top-level host methods fail fixture
  coverage. Keep dynamic capability callbacks on the existing asynchronous transport contract.
- Test every synchronous category through a real worker fixture, including registration, disposal,
  event subscription, and callback return values. Keep bounded waits and existing isolation permissions.
- Publish structural DTOs for task run config and project config/setup, remove those parity holes,
  and assert bidirectional assignability. Keep genuinely opaque framework/database handles documented.
- Preserve range matching and API mismatch checks; renumbering is ticket 10.

## Acceptance

A scaffolded plugin loads with explicit commands; an obsolete manifest produces a named diagnostic.
Compiled and loaded contributions produce equivalent host behaviour where both carriers exist.
Worker tests verify sync methods are not accidentally Promises and async methods do not cross a sync
reply. Permission-denied calls, unload, failed init, retry/reload, and late callbacks stay contained.
Run `pnpm lint`, manifest/worker/RPC suites, `acorn-plugin-types` and `acorn-plugin-sdk` suites, facade
surface tests, and loaded-plugin integration tests. Update snapshots intentionally.

## Verify before building

Read the parity holes and RPC encoder/decoder before widening types. A declaration change alone does
not prove worker semantics, and removing a schema property alone does not reject an obsolete field.
