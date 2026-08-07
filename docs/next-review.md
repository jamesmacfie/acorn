# Documentation follow-ups

The current parent `docs/` tree is the source for shipped behavior. This file records only follow-up
verification and engineering ideas that are not runtime contracts.

## Verification

- Walk the parity checklist against a fresh desktop data root and a two-Node test setup.
- Validate the packaged DMG on a clean macOS account, including `safeStorage`, migrations, native
  modules, PATH discovery, Gatekeeper, preview, and provider setup.
- Exercise Rollbar privacy/interaction cases and Context/Notes slow-response/narrow-layout cases.

## Deferred engineering

- Add retention policies only when measured storage growth justifies them; never apply one blind rule
  to mirrors, blobs, logs, and application-owned records.
- Continue replacing nearby coupling with existing plugin contracts and registries.
- Measure renderer/Node performance from boot marks, storage logs, budgets, and targeted captures.
- Keep workflow authoring file-based until a separate product decision defines an editor and recovery
  model.

These items do not change the current `/v2` contract.
