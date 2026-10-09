# Finish plugin distribution

Date: October 8, 2026. Status: authoring and worker containment implemented; package signing and discovery remain proposed.

Use this folder to plan plugin signing and discovery. Read
[the work plan](./work-plan.md) for dependencies and acceptance requirements.
[Extensibility](../../extensibility.md) and [security](../../security.md) own the implemented boundaries.

## Starting point

The scaffold, published SDK and declarations, folder installation, loaded-package reload, input
approval, development mode, remote trees, and cooperative extension points are implemented.
Loaded Node code runs in a permission-scoped worker realm. This is application isolation;
operating-system containment and a separate crash boundary remain outside that guarantee.

The panel studio and derived sources are implemented. Their remaining work is in
[dashboard followups](../dashboards-gaps.md). They do not block a signing design.
[The Node realm](../../security/plugin-node-realm.md) documents the worker boundary and its limits.

## Remaining work

Design package attestation, then discovery over verified packages. Define update consent and
revocation before changing automatic update behavior. A listing must state whether anyone reviews
its packages; package signature verification alone does not establish a code review.

[Node release packaging](../bundle.md) owns runtime downloads, native binaries, installers, and
macOS signing. [Repository extraction](../split.md) owns moving first-party packages out of the
workspace. These are separate from plugin-package attestation.

## Read this folder

| File | Purpose |
| --- | --- |
| [Distribution gates](./blockers.md) | What signing and discovery must establish, and which prerequisites are implemented. |
| [Work plan](./work-plan.md) | Remaining steps, dependencies, acceptance, and handoff. |
| [Host responsibilities](./shell-vision.md) | Why the host retains security, rendering, and transport responsibilities. |
| [Reference survey](./references-survey.md) | Dated research to recheck before choosing implementation requirements. |
| [Related direction](./where-this-is-going.md) | Separate containment, migration, cloud, and browser work. |
| [Scope decisions](./refused.md) | Limits on discovery, updates, frame authority, and folder provenance. |

## Developer requirements

Keep authoring possible without an Acorn checkout. Preserve published declarations, manifest
compatibility, scaffold tests, installed-package tests, and error messages that name the failed step.
A development install must continue to disclose its mutable bytes and must not claim a signed digest.

Use [published packages](../../plugins/publishing.md),
[plugin authoring](../../plugin-authoring.md), and [the development loop](../../plugins/dev-loop.md)
for the implemented contract. Avoid duplicating those rules in a release service.

## Verify before building

- Recheck published entrypoints, package installation, trust records, and worker enforcement.
- Read the Node realm security contract before relying on an untested adversarial boundary.
- Confirm signing setup and release ownership instead of treating the August blocker list as live evidence.
- Keep discovery dependent on a reviewed signing design and its installed-package acceptance.
