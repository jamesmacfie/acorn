# Complete declarative plugin example

**Status:** Normative example<br>
**Example coordinate:** `example/workspace-bookmarks`<br>
**Requirement prefix:** `EX-DECL`

The validated manifest is
[`plugin-manifest-declarative.json`](../contracts/examples/plugin-manifest-declarative.json). This
document defines the behavior represented by that artifact.

## Purpose

Workspace Bookmarks adds a Fleet source listing owner-selected workspaces and a command that opens
the selected resource. It stores no Node domain data and executes no plugin code. Selection is a
Fleet-owner setting; collapsed groups and last selection are Client presentation state.

## Package

The package contains:

- the signed manifest;
- one declarative UI document bundle and schemas;
- English localization strings; and
- provenance/SBOM records.

It contains no Node runtime, WASI component, native executable, bespoke UI, migration, install
script, HTML, CSS, JavaScript, image, font, or remote schema.

`EX-DECL-001` Artifact verification MUST complete before the host parses the declarative document.
All schema references resolve to signed, digest-addressed package members.

## Contributions

| Contribution | Contract |
| --- | --- |
| Fleet source | `example.workspace-bookmarks.source.v1`; standard list renderer |
| Command | `example.workspace-bookmarks.open.v1`; available from source row and palette |
| Keybinding | No default chord; owner may configure one |
| Settings page | Workspace multi-select using `core.workspace.snapshot.v1` |
| Navigation | Calls `core.navigation.open-resource.v1` with selected canonical URI |

The source document uses `acorn.stack/1`, `acorn.list/2`, `acorn.text/1`,
`acorn.status/1`, and standard loading/empty/error nodes. It binds only the declared core workspace
query and the plugin’s validated selected-URI setting.

`EX-DECL-002` The plugin MUST NOT construct a query, command, resource URI, or property path from
arbitrary text. The workspace options and open action use typed values supplied by the host.

## Permissions

The plugin requests:

- read access to workspace identity presentation for all Nodes paired with the Client; and
- navigation action use on the Client.

It requests no mutation, process, terminal, file, network, secret, agent, event publication,
background worker, or bespoke UI capability.

The owner may deny access to a Node; bookmarks from that Node then render as unavailable cached
labels and can be removed from settings.

## State and lifecycle

The Fleet-owner setting stores canonical workspace URIs and label overrides. A Node does not need
the plugin installed because the contribution is Client-declarative and uses core contracts.
Installation still records the artifact/manifest and grants in the Client Fleet store.

Activation states are `verified → installed → ready`. Setup is optional and consists of the
settings page. Update atomically swaps the document bundle after validation. Uninstall removes the
contribution and, at owner choice, retains or deletes the bookmark setting.

`EX-DECL-003` A missing workspace, revoked Node, malformed cached label, unsupported renderer, or
offline Node MUST produce a host-rendered state. It MUST NOT result in a blank source or dynamic
code fallback.

## Accessibility and mobile constraint

Rows expose workspace label, Node label, connection state, and button semantics. Keyboard focus
order follows visual order. The mobile mapping uses the same list document; no bespoke fallback is
needed.

## Conformance

- Manifest and UI documents validate with unknown fields rejected.
- Injected HTML/script/CSS remains text.
- More than the list/document bounds is rejected before render.
- A forged workspace URI from another owner/Fleet is rejected.
- Denied workspace read removes sensitive metadata while retaining an actionable unavailable row.
- Update with changed permission or executable artifact requires reapproval instead of activation.
- Uninstall leaves no worker, subscription, database, process, origin, or stream.
