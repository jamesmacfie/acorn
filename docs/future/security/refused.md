# Keep the security programme focused

Date: October 7, 2026. Status: scope decisions for proposed requirements; implementation not started.

This page records what the hardening programme leaves out and why. Read it before expanding a phase.
These decisions keep the work to closing the gap between what a boundary claims and what it enforces,
rather than rebuilding the trust model.

## Leave operating-system isolation to rung 3

A loaded plugin's node half runs in a worker, which the stated model calls a resource boundary, not a
sandbox for hostile code. Per-platform operating-system confinement, Seatbelt on macOS, Landlock and
namespaces on Linux, and AppContainer on Windows, is rung 3 in
[the node realm](../../security/plugin-node-realm.md). It is the only thing that gives crash isolation
and a socket-level network boundary that no in-realm code can touch. This programme does not build it.
[Phase 02](./02-plugin-realm-intrinsics.md) and [phase 03](./03-runtime-network-and-fs-backstop.md)
harden the controls that ship today; they do not claim rung 3's properties.

## Do not re-audit the October 1 findings

[The dated review](../../security/review-2026-10-01.md) closed 34 source, runtime, and continuous-
integration findings and recorded its remediations and residual limits. This programme does not revisit
those. It covers what the follow-up pass found at the current baseline: the desktop command
authorization gap, the in-realm policy tampering, the bundled-runtime backstop, the internal-token
exposure when advertised, and the automation driver fence. Where a phase touches an area the review
already covered, it cites the review rather than reopening it.

## Stay single-owner

Acorn is single-owner software, and a paired device has full owner authority by design. This programme
adds no multi-user roles, no per-device permission tiers, and no owner-versus-admin split. The
internal-token work in [phase 04](./04-internal-token-confinement.md) narrows what a leaked child
credential reaches; it does not introduce a role model.

## Do not change what the webviews load

[Phase 01](./01-desktop-command-authorization.md) narrows which webview may call Acorn's own commands.
It does not change the navigation guards, the scheme handlers, or the content the preview and plugin
webviews load. The host allowlist, the remote-content refusal, and the isolated partitions remain as
[the webviews page](../../security/webviews.md) owns them. Reworking how plugin UI is hosted is separate
work.

## Keep the signing key and the HMAC as they are

The internal-token phase adds a loopback peer condition and an expiry. It does not move the signing key,
change the HMAC, or redesign the token format beyond the expiry claim. A broader credential redesign,
such as per-child keys or asymmetric tokens, is a separate decision with migration and reattach
consequences this programme does not take on.

## Do not ship the automation driver to users

[Phase 05](./05-automation-driver-release-fence.md) fences the WebDriver automation server out of
release builds and adds a caller check. It does not turn the driver into a shipped feature, add a
supported remote-control API, or expand what the driver can reach. The driver stays a development tool.
