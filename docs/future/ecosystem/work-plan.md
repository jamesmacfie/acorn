# Implement plugin signing and discovery

Date: October 8, 2026. Status: distribution work proposed; authoring, reload, and worker isolation implemented.

Use this handoff to design package attestation and then build discovery over verified packages.
[Distribution gates](./blockers.md) and [scope decisions](./refused.md) set the constraints.

## Starting point

The installer supports fetched packages and mutable folder installs. Fetched packages have recorded
source, version, archive and entrypoint hashes. Device consent is bound to bytes, and updates can
require permission review. Worker isolation, published authoring packages, and the development loop
are implemented. [Plugin distribution](../../plugins/distribution.md) owns these contracts.

The earlier numbered phases remain in Git history. Phase one delivered authoring and folder install;
phase two delivered worker containment; phase three delivered dashboards. Their implementation
must not be assigned again. [Dashboard followups](../dashboards-gaps.md) records separate open work.

## Design package attestation

Signing has a proposed attestation direction but no completed implementation design. Resolve these
questions before choosing a library or service:

1. Which publisher identities and build identities may sign, and how does an owner recognize them?
2. Which bytes, manifest fields, source revision, version, and API range does the attestation bind?
3. Where are trust roots and attestations stored, and how are they updated, revoked, or rotated?
4. How do offline verification, expired identities, unavailable services, and a compromised publisher behave?
5. How are permission changes presented during updates? A valid signature must not grant permissions
   or replace a person's consent to a changed package.
6. How are first-party bundled packages verified during staging and installed upgrades?

Record the trust model, threat assumptions, contract shapes, failure behavior, and test fixtures in
an implementation plan. Compare signature and attestation approaches against these requirements.
Registry provenance by itself is not an agreed substitute for the designed contract.

## Implement verification

After the design is reviewed, integrate verification into fetched-package installation and updates.
Reuse exact package identity, confinement, staged installation, trust prompts, and audit records.
Define migration for installed lockfiles that lack attestation metadata.

Acceptance must cover valid bytes, changed manifest or bundle bytes, wrong publisher, revoked trust,
failed lookup, offline behavior, downgrade, and an update with added permissions.
A verification failure must leave the working installation available and explain which check failed.
Folder installs remain mutable and outside archive attestation.

## Build discovery

Discovery follows accepted package verification. Define a listing that names publisher, source,
version, API compatibility, permissions, and review status. Bind an install to the selected artifact
and verified digest; do not resolve a different version silently after the person reviews it.

Keep content in the listing separate from trusted application instructions. Define moderation,
removal, unavailable packages, abandoned publishers, and malicious listing metadata.
Use the installed plugin's own authority for its contributions after installation.

Acceptance: find a compatible package, review it, install it, update it with changed permissions,
and remove it. Verify malformed metadata, a removed listing, an incompatible API range, and bytes
that change between listing and download. The trust UI must match the artifact installed.

## Coordinate release work

[Node packaging](../bundle.md) can proceed beside plugin signing. macOS Developer ID signing and
notarization protect application distribution; they do not verify a plugin publisher.
Confirm configured credentials and accounts when checking an external signing blocker.

[Repository extraction](../split.md) also proceeds independently if host builds pin and verify
plugin artifacts. Preserve the development workflow for unpublished plugin and host changes.

## What is deliberately absent

Automatic plugin updates require a separate policy after signing. Do not infer consent from an
attestation. A discovery listing does not imply package review. This work does not widen the frame
sandbox, add plugin-defined predicate languages, or implement downgrade support.

## Verify and hand off

Update installation, supply-chain, publishing, and authoring reference docs when their contracts change.
Run lint, affected owner and consumer suites, architecture checks, and installed-package journeys.
Use disposable data roots for hostile fixtures and record artifact identities in acceptance evidence.

## Verify before building

- Inspect installer staging, hashes, lockfile fields, device trust, input grants, and update decisions.
- Check signing and package registry documentation when selecting the implementation.
- Confirm each prerequisite in the target checkout; do not reuse a historical phase status as test proof.
- Define how failed verification preserves installed packages before adding discovery.
