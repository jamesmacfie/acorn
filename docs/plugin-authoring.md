# Authoring a plugin by hand

Follow [Start from the scaffold](./plugin-authoring/start-from-the-scaffold.md), then use the manifest and node references as needed.

Create a loaded plugin as plain JavaScript files, install the directory, and iterate without a build
step. The host uses the same manifest parser, loader, permissions, and route namespace as a bundled
plugin.

Keep node imports relative or use `node:` builtins. Bundle any npm runtime dependencies before
installation. The client output must be one JavaScript file with no unresolved imports. The scaffold
inlines the bridge and tree protocol, so a tree does not require a bundler.

Use [Contribution kinds](./contribution-kinds.md) to check which features support loaded plugins.
Install `acorn-plugin-types` for editor completion on the node context.

For short integration examples, see [Events and capabilities](./plugin-authoring/events-and-capabilities.md).

## Start from the scaffold


[Start from the scaffold](plugin-authoring/start-from-the-scaffold.md)

## The package


[The package](plugin-authoring/start-from-the-scaffold.md#the-package)

## The manifest

<a id="requiring-another-plugin"></a>
<a id="what-the-builder-normally-supplies-and-you-now-supply-yourself"></a>
<a id="contributions"></a>
<a id="harnesses"></a>
<a id="the-action-verbs"></a>
<a id="permissions"></a>

[The manifest](plugin-authoring/the-manifest.md)

## The node half

<a id="telemetry-and-logging"></a>
<a id="when-there-is-no-ctx-in-reach"></a>
<a id="in-tests"></a>

[The node half](plugin-authoring/the-node-half.md)

## The client half

<a id="drawing-a-tree"></a>
<a id="asking-the-host-for-something"></a>
<a id="reaching-the-bridge"></a>
<a id="telemetry-from-a-frame"></a>
<a id="what-the-bridge-carries"></a>

[The client half](plugin-authoring/the-node-half.md#the-client-half)

## Storage and migrations


[Storage and migrations](plugin-authoring/the-node-half.md#storage-and-migrations)

## Installing a hand-written package


[Installing a hand-written package](plugin-authoring/installing-a-hand-written-package.md)

## A complete example

<a id="acorn-pluginjson"></a>
<a id="nodeindexjs"></a>
<a id="serverroutesjs"></a>
<a id="clientjs"></a>

[A complete example](plugin-authoring/installing-a-hand-written-package.md#a-complete-example)

## Appendix: the frame path


[Appendix: the frame path](plugin-authoring/installing-a-hand-written-package.md#appendix-the-frame-path)

## Updating a plugin, and the data underneath it


[Updating a plugin, and the data underneath it](plugin-authoring/installing-a-hand-written-package.md#updating-a-plugin-and-the-data-underneath-it)

## What this profile refuses, and why


[What this profile refuses, and why](plugin-authoring/installing-a-hand-written-package.md#what-this-profile-refuses-and-why)
