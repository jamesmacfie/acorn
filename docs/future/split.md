# Extract loaded plugins and authoring packages

Date: October 8, 2026. Status: repository extraction proposed; published authoring packages are implemented.

Use this plan to move loaded plugins and authoring packages into separate repositories.
[Published packages](../plugins/publishing.md) owns their names and compatibility rules.
Repository extraction does not require publishing the private compiled-plugin facade.

## Starting point

`create-acorn-plugin`, `acorn-plugin-sdk`, and `acorn-plugin-types` are the published authoring packages.
The SDK includes tree rendering, derived sources, and testing helpers. npm package versions are
independent of `PLUGIN_API_MAJOR`. Do not publish another runtime copy of the host's kit or core.

Eight source plugins use the loaded package shape: agent-cost, database, http, linear, model-providers,
nodes-file, rollbar, and sentry-telemetry. The compiled plugins keep their host dependencies and stay
in this repository. External harness and agent-helper packages already exercise out-of-repository
installation; use their public contracts when evaluating the extraction.

## Repository boundaries

Propose these destinations and confirm release ownership before moving files:

| Destination | Contents |
| --- | --- |
| Authoring toolkit | The three published packages and their declaration, schema, scaffold, and compatibility checks. |
| Loaded plugins | First-party loaded packages, package builds, tests, and release artifacts. A shared repository is sufficient unless a plugin needs independent ownership. |
| Acorn host | Runtimes, core, host kit, compiled plugins, protocol, and compatibility tests for published artifacts. |

The host kit and appearance tokens remain host-owned. Authors render node names with published
props and adapters. A declaration package must describe the loaded context without exposing private
Hono, Drizzle, CodeMirror, or core implementations as required runtime dependencies.

## Extract one pilot plugin

Select a plugin with a demonstrated release benefit. Linear was the original pilot candidate;
recheck its dependency graph before choosing it.

Implement these steps:

1. Audit production and test imports. Replace workspace-only dependencies with published declarations,
   SDK helpers, or local test fixtures. Identify any builder or testkit API that needs a published owner.
2. Build the plugin outside the Acorn workspace. Preserve its manifest, API range, migrations,
   dependency grants, and contribution identities.
3. Publish a versioned plugin artifact containing its manifest and declared bundles. Keep native
   dependencies and host runtime modules out of the artifact.
4. Teach host packaging to fetch and verify an exact artifact version and digest. Preserve the
   development path that builds plugins from a checkout.
5. Test bundled reconciliation with an installed earlier version, an owner override, an uninstall
   tombstone, and a development install. Update a bundled copy without replacing an owner override.
6. Remove the workspace source only after clean host builds, installed upgrades, and both hosts pass.

Acceptance: the plugin builds and tests with no Acorn checkout, a clean host seeds the pinned package,
and an upgrade preserves stored data and owner choices. Failed artifact verification leaves the
working package available. Record how a contributor tests host changes against unpublished plugin changes.

## Extract the toolkit

Preserve the published entrypoints and declaration checks. The host must consume packed artifacts
in compatibility tests so workspace links cannot hide missing files or dependencies.

Keep the generated manifest schema tied to the host protocol contract. Define how an approved host
contract change updates the toolkit, compatibility snapshot, schema, scaffold, and bundled plugins.
Do not hand-maintain a second protocol schema or publish all internal protocol modules for convenience.

If an outside plugin needs a builder or testkit, publish the smallest supported package for that
consumer. The private `@acorn/plugin-api` facade remains an in-repository dependency.

Acceptance: scaffold and build a plugin from installed toolkit artifacts, test a derived source,
validate a manifest, install it on the host, and verify a compatible and incompatible API range.
Run declaration and runtime contract checks against packed packages.

## Release and development requirements

Keep package names and version rules from [published packages](../plugins/publishing.md).
Design release automation against the package registry's supported authentication at implementation time.
Specify version ownership, artifact retention, checksums, rollback, and dependency update handling.
Avoid a separate release system per plugin unless its ownership requires one.

Preserve history from a fresh clone during extraction. Do not rewrite the working repository's history.
Document local cross-repository development beside the scripts that implement it.

## Verify before building

- Recheck loaded manifests, workspace imports, builder usage, published entrypoints, and release owners.
- Inspect `apps/desktop/scripts/stage.mjs` and bundled reconciliation before changing artifact sourcing.
- Read [plugin signing](./plugin-signing.md) for signing and discovery dependencies.
- Run lint, affected owner and consumer suites, architecture checks, and clean packed-artifact acceptance.
