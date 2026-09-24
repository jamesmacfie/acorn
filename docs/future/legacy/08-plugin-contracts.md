# Ticket 08: Explicit plugin contracts

Date: 2026-09-21. Status: implemented on 2026-09-23. Prerequisites: 06, 07.
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

## Implementation evidence

- Manifests use explicit command kinds. The parser names missing kinds and rejects the removed
  `contributions.palette` key before it checks other unknown fields. Built-in packages, scaffolds,
  examples, and the generated schema use the same command form. The scaffold test loads its output
  through the external loader.
- `hostCallModes.ts` lists the loaded context methods and checks that list against
  `NodePluginContext` and `CoreServices` at compile time. An unknown context path throws. A real
  worker fixture checks synchronous registration and disposal, event callbacks, asynchronous core
  calls, and the asynchronous model adapter callback.
- Loaded workers receive only the scoped `NodePluginContext` methods. The worker fixture checks that
  `ctx.tools` and the other compiled-only methods are absent. The model adapter is part of the loaded
  contract: its request and result are data, and its callback is asynchronous. The host checks that
  an adapter belongs to the plugin that registered its connection provider. RPC forwards a later
  `AbortSignal` abort to a running callback and cleans up signal listeners after the call.
- Published task run and project config/setup types are structural. The type contract checks both
  assignability directions. Loaded `telemetry.measure` accepts a synchronous callback; compiled
  plugins can also measure Promise settlement. The published type and worker fixture check that
  difference.

Verification on 2026-09-23: `pnpm lint` passed all 34 package tasks. The Node plugin, plugin host,
and model registry suites passed 408 tests. Loaded plugin integrations passed 52 tests across eight
files. Plugin types passed four tests, the SDK passed two, the plugin API facade passed 12, client
command registration passed 40, and the scaffold passed 11. An isolated desktop service booted with
`model-providers` initialized and reached `ready`. The Tauri renderer stopped at the existing Vite
module import error (`Acorn could not start: Importing a module script failed`), so a window-level
command palette check remains unverified.
