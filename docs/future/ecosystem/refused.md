# Plugin distribution scope decisions

Date: October 8, 2026. Status: retained decisions for signing and discovery work.

Use these decisions when implementing [the work plan](./work-plan.md).
[Extensibility](../../extensibility.md) and [security](../../security.md) own implemented boundaries.

## Require signing before discovery

Discovery must select verifiable package bytes from an identifiable publisher.
Worker isolation is implemented, but it does not establish package identity or supply-chain provenance.
Complete the signing design and installed-package acceptance before building the listing.

## Keep update consent explicit

A signed package may add permissions or read more data. Signature verification does not authorize
that change. Automatic plugin updates need their own consent policy after package signing.

## State review status

A discovery listing must say whether a package receives a code review.
A publisher identity, signature, or listing is not proof that the code was reviewed.

## Preserve frame and host boundaries

Keep the frame size limit, worker restrictions, and network policy.
Use host-owned documents and remote component trees rather than copying privileged host libraries
into a loaded plugin or widening its sandbox.

The host retains storage authority, transport, rendering, and required capabilities.
The reference [host responsibilities](./shell-vision.md) describes conditions that would justify
reassessing that choice. Operating-system isolation needs separate design and acceptance.

## Disclose mutable folder bytes

Folder installs remain unpinned development sources. Their mutable bytes do not acquire fetched-archive
provenance because the installer records a digest at one moment. Preserve the lockfile and prompt disclosure.

## Reuse generated contracts

The generated manifest schema is implemented. Preserve its check against the host's Zod contract.
Do not replace it with a separately maintained copy during repository extraction or discovery work.

## Verify before building

- Read the signing design before changing discovery or update policy.
- Check loaded-package authority, folder provenance, and generated-schema tests after implementation.
- Reassess a scope decision only with a concrete consumer and its authority and lifecycle requirements.
