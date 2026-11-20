# Container image

`apps/node/Dockerfile` builds the standalone Node as a Linux container image. A release publishes it,
and the root README has a Compose file for running it. This page is part of
[Node distribution](../node-distribution.md).

## Build and publish

The `image` job in `.github/workflows/build-node.yml` packs the platform-neutral tarball, builds the
image from it, starts it, and waits for its pairing code. On a `v*` tag it pushes
`ghcr.io/jamesmacfie/acorn-node`, tagged with the version and `latest`, with a provenance attestation
in the registry. A rerun for a version that's already published pushes nothing, so a version's image
never changes. A manual dispatch pushes nothing either, so a branch never replaces `latest`. `ci.yml`
grants the job `packages: write`, plus `id-token: write` and `attestations: write` for the attestation.

The image is for Linux x64 only. It compiles node-pty, and an arm64 build would compile under
emulation on an x64 runner. The image runs anywhere Docker runs, including a Mac too old for the macOS
archive, which needs macOS 13.5 because of its Node.js 24 runtime.

## What's inside

The image holds Git, tmux, ripgrep, and the `claude` and `codex` commands, so agents run inside the
container. The Dockerfile pins each CLI to an exact version in an `ARG`, so the image changes only when
someone edits the version there. Pick a release at least a week old, the workspace's
`minimumReleaseAge`. The Node runs as the `acorn` user, with its data root on the `/data` volume. The CLIs keep
their default logins in `/home/acorn`, so a deployment keeps that folder on a volume too, or loses the
logins when the container is replaced. Extra agent accounts live in the data root already.

The `acorn` command isn't on the image's `PATH`, and a CLI inside the container isn't paired with the
Node. For a fresh pairing code, send the Node `SIGUSR1`: `docker compose kill -s USR1 acorn-node`.

## Mounted folders

A person mounts their projects folder at `/projects`. Docker Desktop and OrbStack show mounted files as
owned by the user reading them, so Git accepts the repositories without a `safe.directory` entry.
That was checked on OrbStack, October 27, 2026.
