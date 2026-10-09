# Plugin distribution gates

Date: October 8, 2026. Status: package signing and discovery proposed; authoring and worker containment implemented.

Read these gates before implementing [the distribution plan](./work-plan.md).
[Supply-chain security](../../security/plugin-storage-and-supply-chain.md) owns installed-package rules.

## Package signing and discovery

Fetched packages are hash-pinned and audited. Package attestation and a discovery listing are not
implemented. A digest identifies bytes; it does not establish who published or built them.
The signing design must define publisher identity, artifact binding, trust roots, revocation, and
failure behavior before discovery can depend on it.

Keep the following gates explicit:

- Verify the selected artifact before installation or update.
- Preserve byte-bound trust and permission review even when a signature is valid.
- State whether a listed package receives any code review. Do not infer review from listing or signing.
- Design automatic update consent separately; signing alone does not authorize changed permissions.

## Implemented prerequisites

Authoring, folder installation, reload, and worker isolation are implemented. Use their owning docs:

- [Published packages](../../plugins/publishing.md) covers scaffold, SDK, declarations, and compatibility.
- [Folder installation](../../security/plugin-install.md) covers mutable local sources and trust.
- [The Node realm](../../security/plugin-node-realm.md) covers permission-scoped workers and their limits.
- [Plugin activation](../../plugins/activation.md) covers installation, activation, and replacement.

Verify the documented worker limits before relying on containment for plugin distribution.

## Mutable folder sources

A folder installation can change after installation. Keep its lockfile and prompt truthful about
that property. Recording an archive digest for a mutable symlink would falsely claim pinned bytes.
Attestation of fetched packages does not change the folder-development contract.

## Scope boundaries

The closed host kit, frame limits, and restricted action vocabulary are deliberate contracts.
Use host-owned document and tree rendering when a plugin needs them. Capabilities, references,
hooks, and cooperative extension points provide interoperation without importing a peer's internals.
[Scope decisions](./refused.md) records the reasoning.

## Verify before distribution

- Test fetched hashes, downgrade refusal, update consent, and staged-install failure recovery.
- Recheck hostile worker fixtures against the Node realm security contract.
- Verify lockfile migration and mutable-source disclosure under the accepted signing design.
