# Sign plugin packages, then build discovery

Date: October 8, 2026. Status: proposed. Authoring, reload, and worker isolation are implemented.
Merged from the retired `docs/future/ecosystem/` folder on October 26, 2026.

Use this plan to design package signing, check signatures on install and update, and then build a
listing where people find plugins. [Plugin distribution](../plugins/distribution.md) and
[supply-chain security](../security/plugin-storage-and-supply-chain.md) own the implemented rules.

## Starting point

The installer supports fetched packages and folder installs. A fetched package records its source,
version, archive hash, and entrypoint hash. Device consent is bound to those bytes, and an update
with new permissions asks again. A hash identifies bytes. It doesn't say who published or built them.

## Rules that hold throughout

- Signing comes before discovery. A listing must point at bytes that can be checked against a known
  publisher.
- A valid signature doesn't approve changed permissions. Automatic updates need their own consent
  policy, designed after signing.
- A listing states whether anyone reviewed the code. A signature or a listing isn't a review.
- Folder installs stay unpinned. Their bytes keep changing, so they never claim a signed hash.
  Keep the lockfile and prompt honest about that.
- Signing doesn't widen the frame sandbox, the worker restrictions, or the network policy.

## Design package signing

Answer these before choosing a library or service:

1. Which publisher and build identities may sign, and how does an owner recognize them?
2. Which bytes, manifest fields, source revision, version, and API range does the signature cover?
3. Where are trust roots and signatures stored, and how are they updated, revoked, or rotated?
4. What happens offline, with an expired identity, with an unavailable service, or with a
   compromised publisher?
5. How does an update show permission changes? A valid signature must not grant permissions.
6. How are first-party bundled packages checked during staging and installed upgrades?

Write down the trust model, threat assumptions, contract shapes, failure behavior, and test fixtures.
Registry provenance alone isn't an agreed substitute. Layer on the existing lockfile fields rather
than inventing a format nobody else can check.

## Check signatures on install and update

Build this after the design is reviewed. Reuse exact package identity, staged installation, trust
prompts, and audit records. Define how installed lockfiles without signature fields migrate.

Acceptance covers valid bytes, changed manifest or bundle bytes, the wrong publisher, revoked trust,
a failed lookup, offline use, a downgrade, and an update that adds permissions. A failed check leaves
the working installation in place and names the check that failed.

## Build discovery

A listing names the publisher, source, version, API compatibility, permissions, and review status.
An install is bound to the selected artifact and its checked hash. It never quietly resolves a
different version after the person reviewed one. Listing text is untrusted content, never
application instructions. Define moderation, removal, unavailable packages, abandoned publishers,
and malicious metadata.

Acceptance: find a compatible package, review it, install it, update it with changed permissions,
and remove it. Also check malformed metadata, a removed listing, an incompatible API range, and
bytes that change between listing and download. The trust prompt must match the installed artifact.

## Related work

[Node packaging](./bundle.md) and [repository extraction](./split.md) can proceed alongside this.
macOS Developer ID signing protects the app download. It doesn't verify a plugin publisher.

## Before you build

- Inspect installer staging, hashes, lockfile fields, device trust, input grants, and update decisions.
- Update the installation, supply-chain, publishing, and authoring docs when their contracts change.
- Run hostile fixtures against disposable data roots and record artifact identities in the evidence.
