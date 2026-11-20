# D-1. Standalone releases resolve a mutable dependency graph

Found November 20, 2026, in Acorn at `90b9e61e3`. Severity is medium for supply-chain exposure.
The packaging behavior is confirmed from source. Status is open.

## Evidence and impact

`scripts/pack-node.mjs` resolves an npm lockfile from runtime dependency ranges during packaging.
It installs from that lockfile with npm lifecycle scripts enabled. The workspace pnpm build-script
allowlist does not apply to that step. The release matrix can resolve different dependency
versions for different platforms, and `.github/workflows/build-node.yml` can replace artifacts
for an existing tag. `apps/node/Dockerfile` also installs the agent CLIs without exact versions.

A dependency update can enter a standalone build independently of the reviewed workspace lockfile.
A compromised eligible dependency can execute during a release build or on the installed Node.
The age floor and audit reduce exposure. They do not bind a release to a reviewed dependency graph.
See [standalone dependency security](../../node-distribution/dependency-security.md).

## Fix and verification

Resolve and review one release lockfile for the version, then use it on each platform. Keep
lifecycle scripts disabled by default and explicitly build the packages that require them. Pin
the container's agent CLIs. Keep released artifacts immutable and publish provenance for them.

Verify that repeated builds for a release use the same resolution and that the only install
scripts that run are on the release allowlist. Check that a publishing rerun cannot change an
already published archive under the same version.
