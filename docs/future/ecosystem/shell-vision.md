# Host responsibilities in a plugin workspace

Date: October 8, 2026. Status: retained architecture direction.

Use this decision when a plugin proposal requires host privileges.
[Extensibility](../../extensibility.md) owns the two tiers, and
[first-party plugins](../../first-party-plugins.md) records the dependencies that keep a plugin compiled.

## Keep authority and rendering with the host

The host owns authentication, trust records, transport, task/project addressing, storage authority,
and rendering contracts. Plugins contribute integrations, data sources, panes, tools, themes, and
workflow behavior through those contracts.

A loaded plugin receives data and asynchronous operations through its declared context.
It does not acquire host privileges because an equivalent compiled plugin has them.
A request for stream ownership, native dependencies, or a required startup capability needs an
owner-specific design or first-party adoption.

## Use host components for plugin UI

Remote trees let a plugin contribute host components by node name and semantic props.
The host mounts its own implementation. A tree does not transfer component code into the shell.
This removes some in-realm UI dependencies, such as Changes' transcript card.

A host-owned document lets a plugin declare text, language, reads, and saves without shipping an
editor engine. CodeMirror is the implemented engine. Keep vendor-specific objects out of public
contracts and preserve document custody at the host.

These rendering contracts do not remove WebSocket ownership, native library requirements,
synchronous state, or mandatory capabilities. Assess those separately before a migration.

## Preserve authoring and consent

An agent can propose a plugin and iterate through an approval-mediated install and development grant.
The published scaffold, SDK, declarations, reload, and permission-scoped worker are implemented.
Distribution adds publisher verification; it must preserve the owner's consent to bytes and permissions.

Keep local development possible without discovery or a signing service. A mutable folder install
must disclose its provenance limit. Package signing and discovery have their own
[implementation plan](./work-plan.md).

## Revisit conditions

Reassess a smaller host only when operating-system isolation and a renderer contract can support
its concrete consumers without widening their authority. Record crash behavior, resource budgets,
compatibility, and hostile-package acceptance before moving a responsibility.

Remote trees do not establish those conditions for native or stream owners. Revisit with an actual
consumer and an approved boundary design, rather than moving code solely to reduce the compiled roster.

## Verify before building

- Trace the requested privilege to its owner and downstream consumers.
- Compare the request with loaded context, tree, document, and transport contracts.
- Preserve required startup capabilities and persisted state during an approved move.
