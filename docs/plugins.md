# Plugins

Use the topic links below for the plugin API and host contracts. For a third-party package, start with the [authoring guide](./plugin-authoring.md).

Plugins come in two tiers. Built-ins are first-party packages compiled into acorn and registered by
the Node/client composition roots. Loaded plugins are installed at runtime from a manifest plus ESM
bundles. Either tier can contribute Node behavior, client behavior, or both; the available carriers
and trust boundary differ by tier.

This file is the mechanism. [extensibility.md](./extensibility.md) is the reasoning — why there are
two tiers, where the line between them is, and which of the constraints below are deliberate rather
than unfinished. Read it before widening a seam.
[plugin-authoring.md](./plugin-authoring.md) is the subset of this file an author needs to write a
loaded plugin **by hand, with no build step** — plain multi-file ESM on the node, one vanilla-JS file
in the frame — with a complete worked example.

## Package shape


[Package shape](plugins/package-shape.md)

## The plugin API

<a id="one-vocabulary-across-the-registries"></a>
<a id="the-two-contexts-one-per-tier"></a>
<a id="what-is-published-and-what-acorn-promises-about-it"></a>
<a id="the-manifest-schema"></a>
<a id="hono-and-drizzle-cross-into-tier-1-on-purpose"></a>
<a id="the-testkit"></a>

[The plugin API](plugins/package-shape.md#the-plugin-api)

## Activation


[Activation](plugins/activation.md)

## Loaded plugins


[Loaded plugins](plugins/activation.md#loaded-plugins)

## The dev loop

<a id="reloading-one-plugin-without-a-restart"></a>

[The dev loop](plugins/activation.md#the-dev-loop)

## Approval-mediated install

<a id="what-the-owner-can-know-before-the-download"></a>

[Approval-mediated install](plugins/activation.md#approval-mediated-install)

## Development mode


[Development mode](plugins/activation.md#development-mode)

## Teaching the agent


[Teaching the agent](plugins/activation.md#teaching-the-agent)

## The client half of a loaded plugin


[The client half of a loaded plugin](plugins/activation.md#the-client-half-of-a-loaded-plugin)

## Frames

<a id="binary-bridge-calls"></a>

[Frames](plugins/frames.md)

## Remote trees


[Remote trees](plugins/frames.md#remote-trees)

## Document surfaces

<a id="document-over-frame"></a>
<a id="language-smarts"></a>

[Document surfaces](plugins/frames.md#document-surfaces)

## Webviews


[Webviews](plugins/frames.md#webviews)

## Descriptors


[Descriptors](plugins/descriptors.md)

## The tree contract


[The tree contract](plugins/descriptors.md#the-tree-contract)

## One shared eligibility and trust check


[One shared eligibility and trust check](plugins/descriptors.md#one-shared-eligibility-and-trust-check)

## Descriptors for facts, trees for UI, rectangles for pixels


[Descriptors for facts, trees for UI, rectangles for pixels](plugins/descriptors-for-facts-trees-for-ui-rectangles-for-pixels.md)

## Keeping a descriptor fresh

<a id="raising-a-notification"></a>
<a id="the-live-channel"></a>

[Keeping a descriptor fresh](plugins/descriptors-for-facts-trees-for-ui-rectangles-for-pixels.md#keeping-a-descriptor-fresh)

## Context menus

<a id="three-lists-one-menu"></a>

[Context menus](plugins/descriptors-for-facts-trees-for-ui-rectangles-for-pixels.md#context-menus)

## Rail markers


[Rail markers](plugins/descriptors-for-facts-trees-for-ui-rectangles-for-pixels.md#rail-markers)

## Cooperative extension points

<a id="five-kinds-four-rules"></a>
<a id="rows"></a>
<a id="annotations"></a>
<a id="remote-trees"></a>
<a id="asking-the-owner"></a>
<a id="companion-overlays"></a>
<a id="rectangles"></a>
<a id="arbitration-who-fills-a-box"></a>
<a id="what-the-host-binds"></a>
<a id="seeing-what-matched"></a>

[Cooperative extension points](plugins/cooperative-extension-points.md)

## Node-side extension points


[Node-side extension points](plugins/node-side-extension-points.md)

## Hooks


[Hooks](plugins/node-side-extension-points.md#hooks)

## Node providers

<a id="the-first-party-rule"></a>

[Node providers](plugins/node-side-extension-points.md#node-providers)

## Replacing a core surface


[Replacing a core surface](plugins/node-side-extension-points.md#replacing-a-core-surface)

## There is no uncooperative extension


[There is no uncooperative extension](plugins/node-side-extension-points.md#there-is-no-uncooperative-extension)

## Client authoring and the UI kit

<a id="command-kinds"></a>

[Client authoring and the UI kit](plugins/client-authoring-and-the-ui-kit.md)

## Task checks


[Task checks](plugins/client-authoring-and-the-ui-kit.md#task-checks)

## Harnesses


[Harnesses](plugins/client-authoring-and-the-ui-kit.md#harnesses)

## Forward compatibility


[Forward compatibility](plugins/forward-compatibility.md)

## Collaboration rules


[Collaboration rules](plugins/forward-compatibility.md#collaboration-rules)

## Data ownership

<a id="uninstalling-and-what-purged-means"></a>

[Data ownership](plugins/forward-compatibility.md#data-ownership)

## Tool projection


[Tool projection](plugins/forward-compatibility.md#tool-projection)

## Adding a plugin contribution

<a id="the-files-a-contribution-touches"></a>
<a id="the-golden-lists"></a>

[Adding a plugin contribution](plugins/forward-compatibility.md#adding-a-plugin-contribution)
