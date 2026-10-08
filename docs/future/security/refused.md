# Keep the security programme focused

Date: October 8, 2026. Status: scope decisions for proposed requirements; implementation not started.

This page records what the hardening programme leaves out and why. Read it before expanding a phase.
These decisions cover trust-boundary hardening and the five agent-tooling phases. They preserve the
single-owner model and keep each feature honest about the operations it can inspect or gate.

## Keep full host agent execution available

The owner selected instruction review, diagnostics, dependency review, managed MCP setup, and secret
publication checks. Restricted agent execution is outside scope. Add no container or VM backend,
agent filesystem or network sandbox, credential injection proxy, or sandbox permission prompts.
Docker, databases, browser checks, native tooling, and the normal Runn development workflow remain available.

An agent-process sandbox would also require policy on Acorn's own terminal and run-target execution
and on delegated agents. Leaving those unrestricted would leave another route to host execution.
This programme does not undertake that execution-policy redesign. Phase 03's loaded-plugin runtime
backstop retains its original scope and is not an agent execution sandbox.

## Do not claim input review contains arbitrary code

Release age and integrity do not establish package intent. An unchanged MCP catalogue does not establish
unchanged server behaviour. A pre-turn instruction review cannot intercept every file read or edit
during a turn. Device-only routes do not defend their on-disk state from owner-level host code.
Keep these limits in Settings, review results, and the shipped security docs.

## Keep diagnostics passive and ownership narrow

Phase 07 does not execute configured hooks, install packages, start MCP servers, contact providers to
validate credentials, or change settings to discover risk. Unknown evidence is an acceptable result.
Do not add a security score, automatic remediation, a cross-plugin database reader, or a generic
inspection framework. Add narrow typed contracts only for demonstrated consumers.

## Bound formats and publication coverage

Phase 08 starts with npm and pnpm data formats. Phase 09 manages exact npm MCP packages; arbitrary
commands and HTTP servers keep their own disclosed authority. Phase 10 covers named Acorn-owned
publication actions. Yarn, Bun, Python installation management, OCR, arbitrary binary analysis,
and universal shell or browser upload interception are separate work.

Secret detection uses local evidence. Do not upload source for scanning, run live credential validation,
automatically revoke credentials, or silently rewrite stored transcripts and artifacts. Optional
metadata fetching sends package coordinates only after an explicit owner action.

## Keep security admission separate from optional hooks

Mandatory checks selected by the owner stop when incomplete. Implement them at their owning operation,
without changing every optional hook to fail closed. Direct terminal Git, arbitrary package-manager
commands, external applications, and unproxied harness MCP connections remain outside those gates.
One-operation exceptions require the device and exact reviewed bytes; they do not approve other vetoes.

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
