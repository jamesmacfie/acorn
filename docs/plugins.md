# Plugins

This is the plugin reference: how both plugin tiers work, from package layout to the contracts between
plugins. Read it when you change a host seam or need the exact rules behind an authoring guide. For a
third-party package, start with the [authoring guide](./plugin-authoring.md). For a one-page
orientation, read the [plugin map](./plugin-map.md).

Plugins come in two tiers. Compiled plugins are first-party packages built into acorn and registered
by the Node and client composition roots. Loaded plugins are installed at runtime from a manifest plus
ESM bundles, and run in sandboxes. Either tier can contribute Node behavior, client behavior, or both,
and the carriers and trust boundary differ by tier. [Extensibility](./extensibility.md) explains why
there are two tiers and which constraints are deliberate. Read it before widening a seam.

## Packages and the API

- [Package shape](./plugins/package-shape.md): the folder layout and exports map every plugin uses.
- [The plugin API](./plugins/plugin-api.md): the private facade, the two node context types, and the
  shared registry verbs.
- [Published packages](./plugins/publishing.md): the npm packages, the compatibility promise, and
  what the host does with a manifest.
- [Testing a plugin](./plugin-authoring/testing.md): the testkit.

## Lifecycle and distribution

- [Activation](./plugins/activation.md): start order, failures, what a plugin registers, and what the
  owner sees under **Settings > Plugins > Installed**. Rail icon visibility is in
  [rail source visibility](./frontend/rail-and-routing.md#rail-source-visibility).
- [Loaded plugins](./plugins/loaded-plugins.md): the installer, contained failures, the context the
  manifest shapes, and package input limits.
- [Distribution](./plugins/distribution.md): bundled packages, running identity, device trust, and the
  shared eligibility check.
- [The dev loop](./plugins/dev-loop.md): rebuilding, reloading one plugin, and trust prompts in
  development.
- [Agent installs and development mode](./plugins/agent-install.md): approval-mediated install, the
  dev trust grant, and teaching the agent.
- [The client half of a loaded plugin](./plugins/client-half.md): how a device turns a manifest into
  UI, and device-held plugins.

## Drawing UI

- [Choosing how a plugin draws](./plugins/ui-tiers.md): descriptors for facts, trees for UI,
  rectangles for pixels, and the two descriptor slots.
- [Frames](./plugins/frames.md): the iframe path, the bridge's enforcement, and binary calls.
- [Remote trees](./plugins/remote-trees.md): the worker path and per-tree bridges.
- [The tree contract](./plugins/tree-contract.md): the wire format between a sandbox and a host.
- [Document surfaces and webviews](./plugins/document-surfaces.md): host-drawn documents and pages.
- [Client authoring and the UI kit](./plugins/client-authoring-and-the-ui-kit.md): the build
  transform, kit rules, client contribution points, and trust gating.
- [Commands and keybindings](./plugins/commands.md): command kinds, chords, and claimed keys.

## Descriptors

- [Descriptors](./plugins/descriptors.md): rail sources, content links, routes, and action verbs.

Content-link contributions can also address a declared target by plugin-owned kind and item ID,
including records with no URL. The contribution declares the presentations it supports; the host
chooses the destination and keeps panel plans outside plugin frames.
- [Rail presentation and artwork](./plugins/rail-presentation.md): live artwork and words on a rail
  button, and how the host reads a plugin's pictures.
- [More descriptors](./plugins/more-descriptors.md): agent contexts, reference resolvers, typed data
  sources, schedules, node actions, and themes.
- [Keeping a descriptor fresh](./plugins/freshness.md): refresh, status, notices, and the live channel.
- [Context menus and rail markers](./plugins/menus-and-markers.md).

## Extension points

- [Cooperative extension points](./plugins/cooperative-extension-points.md): the five kinds, the four
  rules, arbitration, and what the host binds.
- [Rows and annotations](./plugins/rows-and-annotations.md), including task annotations.
- [Remote points](./plugins/remote-points.md): trees and rectangles in another plugin's surface,
  asking the owner, and companion overlays.
- [Node-side extension points](./plugins/node-side-extension-points.md).
- [Hooks](./plugins/hooks.md): deciding before something happens.
- [Node providers](./plugins/node-providers.md): putting Nodes in the fleet.
- [Replacing a core surface](./plugins/replacing-core-surfaces.md).

## Node contributions

- [Task checks](./plugins/task-checks.md): what a plugin says before an archive.
- [Search providers](./plugins/search-providers.md): grouped search across plugins.
- [Harnesses](./plugins/harnesses.md): how the host delivers a managed agent declared as data.
- [Code hosts](./plugins/code-hosts.md): claiming Git hosts, a project's repository facet, and change
  requests.

## Working together

- [Forward compatibility](./plugins/forward-compatibility.md): what happens to input this build
  doesn't know.
- [Events](./plugins/events.md): hearing core and other plugins, and the shipped event list.
- [Collaboration rules](./plugins/collaboration.md): contracts, capabilities, and client capabilities.
- [Data ownership](./plugins/data-ownership.md): plugin databases, uninstalling, and tool projection.
- [Adding a plugin contribution](./plugins/adding-a-contribution.md): the steps, the files, and the
  golden lists.
