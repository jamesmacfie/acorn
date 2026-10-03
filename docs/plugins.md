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

<a id="package-shape"></a>
<a id="the-plugin-api"></a>
<a id="one-vocabulary-across-the-registries"></a>
<a id="the-two-contexts-one-per-tier"></a>
<a id="what-is-published-and-what-acorn-promises-about-it"></a>
<a id="the-manifest-schema"></a>
<a id="hono-and-drizzle-cross-into-tier-1-on-purpose"></a>
<a id="the-testkit"></a>

- [Package shape](./plugins/package-shape.md): the folder layout and exports map every plugin uses.
- [The plugin API](./plugins/plugin-api.md): the private facade, the two node context types, and the
  shared registry verbs.
- [Published packages](./plugins/publishing.md): the npm packages, the compatibility promise, and
  what the host does with a manifest.
- [Testing a plugin](./plugin-authoring/testing.md): the testkit.

## Lifecycle and distribution

<a id="activation"></a>
<a id="managing-installed-plugins"></a>
<a id="loaded-plugins"></a>
<a id="the-dev-loop"></a>
<a id="reloading-one-plugin-without-a-restart"></a>
<a id="approval-mediated-install"></a>
<a id="what-the-owner-can-know-before-the-download"></a>
<a id="development-mode"></a>
<a id="teaching-the-agent"></a>
<a id="the-client-half-of-a-loaded-plugin"></a>
<a id="device-held-plugins"></a>
<a id="one-shared-eligibility-and-trust-check"></a>

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

<a id="frames"></a>
<a id="binary-bridge-calls"></a>
<a id="remote-trees"></a>
<a id="document-surfaces"></a>
<a id="document-over-frame"></a>
<a id="language-smarts"></a>
<a id="webviews"></a>
<a id="the-tree-contract"></a>
<a id="descriptors-for-facts-trees-for-ui-rectangles-for-pixels"></a>
<a id="client-authoring-and-the-ui-kit"></a>
<a id="command-kinds"></a>

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

<a id="descriptors"></a>
<a id="keeping-a-descriptor-fresh"></a>
<a id="raising-a-notification"></a>
<a id="the-live-channel"></a>
<a id="context-menus"></a>
<a id="three-lists-one-menu"></a>
<a id="rail-markers"></a>

- [Descriptors](./plugins/descriptors.md): rail sources, content links, routes, and action verbs.

Content-link contributions can also address a declared target by plugin-owned kind and item ID,
including records with no URL. The contribution declares the presentations it supports; the host
chooses the destination and keeps panel plans outside plugin frames.
- [More descriptors](./plugins/more-descriptors.md): agent contexts, reference resolvers, typed data
  sources, schedules, node actions, and themes.
- [Keeping a descriptor fresh](./plugins/freshness.md): refresh, status, notices, and the live channel.
- [Context menus and rail markers](./plugins/menus-and-markers.md).

## Extension points

<a id="cooperative-extension-points"></a>
<a id="five-kinds-four-rules"></a>
<a id="rows"></a>
<a id="annotations"></a>
<a id="asking-the-owner"></a>
<a id="companion-overlays"></a>
<a id="rectangles"></a>
<a id="arbitration-who-fills-a-box"></a>
<a id="what-the-host-binds"></a>
<a id="seeing-what-matched"></a>
<a id="node-side-extension-points"></a>
<a id="hooks"></a>
<a id="node-providers"></a>
<a id="the-first-party-rule"></a>
<a id="replacing-a-core-surface"></a>
<a id="there-is-no-uncooperative-extension"></a>

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

<a id="task-checks"></a>
<a id="search-providers"></a>
<a id="harnesses"></a>

- [Task checks](./plugins/task-checks.md): what a plugin says before an archive.
- [Search providers](./plugins/search-providers.md): grouped search across plugins.
- [Harnesses](./plugins/harnesses.md): how the host delivers a managed agent declared as data.

## Working together

<a id="forward-compatibility"></a>
<a id="collaboration-rules"></a>
<a id="data-ownership"></a>
<a id="uninstalling-and-what-purged-means"></a>
<a id="tool-projection"></a>
<a id="adding-a-plugin-contribution"></a>
<a id="the-files-a-contribution-touches"></a>
<a id="the-golden-lists"></a>

- [Forward compatibility](./plugins/forward-compatibility.md): what happens to input this build
  doesn't know.
- [Events](./plugins/events.md): hearing core and other plugins, and the shipped event list.
- [Collaboration rules](./plugins/collaboration.md): contracts, capabilities, and client capabilities.
- [Data ownership](./plugins/data-ownership.md): plugin databases, uninstalling, and tool projection.
- [Adding a plugin contribution](./plugins/adding-a-contribution.md): the steps, the files, and the
  golden lists.
