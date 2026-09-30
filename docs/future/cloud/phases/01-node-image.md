# Phase 1: the Node image on cloud hardware

Status: proposed, 2026-09-29.

## Goal

Build the acorn Node as a container image, run it on the chosen compute provider, and use it from
desktop and TUI as an ordinary paired remote Node. No accounts, no relay, no control plane.

This phase proves the base everything else stands on: that the standalone Node runs well in a
container, that the provider can place and boot it fast enough in a chosen region, and what that
costs. Every hosted Node in later phases is this image.

## What you can deploy at the end

- A published Node image, built by CI on a tagged release.
- A documented recipe for running your own acorn Node on the provider and pairing to it.
- Measured boot times and a first cost estimate, recorded in this file.

A self-hoster can use this on its own. It is the first cloud-shaped thing acorn ships.

## Starting point

- `pnpm pack:node` builds the standalone tarball (`scripts/pack-node.mjs`).
- The standalone entry reads `ACORN_DATA_DIR`, `ACORN_ADVERTISE_HOST`, and `ACORN_PORT`, prints a
  handshake line and a pairing banner, and drains on SIGTERM ([node distribution](../../../node-distribution.md)).
- `node-pty` is the only native module, and `apps/node/externals.ts` lists the packages installed
  beside the bundle.
- A standalone Node has no bundled loaded plugins unless `ACORN_BUNDLED_PLUGINS_DIR` names a folder.
- [The bundle design](../../bundle.md#docker-2026-08-22) sketches a two-stage image and names three
  container decisions. None of it is built. No Dockerfile exists for acorn.

## In scope

- The image: base, native build, task tooling, loaded plugins, non-root user, data volume.
- Running it locally with Docker and pairing desktop and TUI.
- Running it on the provider in one region with a persistent volume.
- Boot time measurements and a cost estimate.
- CI that builds and publishes the image.

## Out of scope

Accounts, enrollment, relay, cloud tasks, and anything multi-person. The model key in this phase is
set by hand as a provider secret. That is a named shortcut for a single self-hoster, replaced in
[phase 7](./07-isolation.md).

## Steps and checkpoints

### 1. Write the image

Add `apps/node/Dockerfile` (new). Recommended shape:

- Build stage from `node:24-bookworm-slim` that runs `pnpm pack:node`, installs the externals, and
  compiles `node-pty`.
- Runtime stage from the same base, with `git`, `openssl`, `tmux`, `ripgrep`, `ca-certificates`,
  and the agent CLIs acorn drives (Claude Code and Codex to start).
- The built loaded plugins copied into the image, with `ACORN_BUNDLED_PLUGINS_DIR` pointing at them,
  so the image carries the same plugins as the desktop.
- A non-root `acorn` user, `ACORN_DATA_DIR=/data`, and `/data` declared as a volume.
- A fixed `ACORN_PORT`, because the Host check compares the port, and a remapped port fails as a
  bare 403.

**Checkpoint 1: the image boots.** Run `docker build`, then run the container with a named volume.
You should see the `[service:boot]` lines, the handshake line, and the pairing banner in
`docker logs`. `docker stop` should exit 0 within the 30-second drain.

### 2. Pair from the desktop and the TUI

Run the container with the port published at the same number and `ACORN_ADVERTISE_HOST` set to the
name you dial, such as `localhost`. The Node binds all interfaces only when something is advertised.

**Checkpoint 2: desktop pairs.** In Settings → Nodes, pair `https://localhost:<port>`. Compare the
six identity words with the banner. Enter the code. The Node should appear, and the Fleet source
should appear in the rail.

**Checkpoint 3: TUI pairs.** Check whether the TUI and CLI can pair a remote Node by address. If
they can, pair and open the workspace. If they cannot, record it as a gap. [Phase 3](./03-team-node.md)
needs TUI access to a remote Node.

**Checkpoint 4: real work in the container.** On the container Node, connect GitHub through the
device flow, add a project by cloning a repository into `/data`, create a task, and run a Claude
agent with the model key passed as an environment variable. Open the terminal and the diff. The
agent should run, and the diff should show its changes.

### 3. Run it on the provider

Create a provider app in one region with a persistent volume mounted at `/data`. Expose the Node's
port as raw TCP passthrough, so the Node's own TLS reaches the client unchanged and pinning still
works. Do not use the provider's TLS termination. Set `ACORN_ADVERTISE_HOST` to the app's public
hostname.

**Checkpoint 5: pair over the internet.** Read the pairing banner from the provider's logs. Pair the
desktop from a different network. The identity words should match.

**Checkpoint 6: the laptop closes, the work goes on.** Start an agent task that takes several
minutes. Close the laptop. Reopen it after the agent should have finished. The transcript should show
the whole run.

**Checkpoint 7: restart keeps state.** Restart the machine. The Node should come back with the same
Node ID and fingerprint, and the desktop should reconnect without repairing. Projects, tasks, and
transcripts should be intact.

### 4. Measure

Record, for at least 20 runs each:

- Time from the provider's create call to the handshake line, with the image cached in the region.
- The same with a cold image.
- Time from machine start to handshake line for a stopped machine.
- Image size, and memory and CPU at idle and during an agent turn.

If warm create-to-handshake is not well under 15 seconds, leaving room for enrollment and adoption,
repeat the measurement on one alternative provider from [hosting and cost](../hosting-and-cost.md#candidates-as-of-2026-09-11).

Price the measured CPU, memory, storage, and transfer at the provider's current rates.

### 5. Publish

Add a CI workflow that builds the image for the chosen architectures on a tagged release, runs a
smoke test that boots the image and checks the handshake line, and pushes it to the registry.
Consider moving `apps/node/test/integration/lifecycle/enrollment.test.ts` to run against the image,
as [Node enrollment](../../../node-enrollment.md#testing-against-a-stub) suggests.

**Checkpoint 8: the published image works.** On a clean machine, pull the published image, run it,
and pair to it by following only the written recipe.

## Acceptance

- The image boots, pairs, runs an agent, and drains cleanly, locally and on the provider.
- Restart on the provider keeps identity and data.
- Boot measurements and a cost estimate are recorded below with dates.
- The recipe is in [node distribution](../../../node-distribution.md) and a reader followed it
  without help.

## Docs to update when it ships

- [Node distribution](../../../node-distribution.md): a container section, with the port rule, the
  advertise rule, and the volume.
- [The bundle design](../../bundle.md): mark the Docker section shipped.

## Open questions

1. Which architectures does the image target: `amd64` only, or `arm64` too? The answer depends on
   the provider's machine types and prices.
2. Which agent CLIs are baked in, how are they pinned, and how often is the image rebuilt to update
   them?
3. What is the image size budget? Agent CLIs and their runtimes can dominate it.
4. Which registry: the provider's own, or GitHub Container Registry? Pull speed in each region
   decides it.
5. Is the image public? Recommended yes, since the Node is open source, but it decides whether
   private cloud-only tooling can ever go in it.
6. Does the team Node use the same image as a worker, or a slimmer one without agent CLIs?
7. What volume size does a single self-hosted Node need, and how does a person grow it?
8. How does a person get the pairing code without reading logs? A provider console command, a
   one-time URL, or waiting for the account-based flow in phase 3.
9. Can the TUI and CLI pair a remote Node by address? If not, what is the smallest change?
10. How do provider health checks work against a Node that answers only pinned HTTPS? `GET /v1/node`
    is unauthenticated, but the provider must accept a self-signed certificate or use a TCP check.

## Evidence

Record measurements here, with dates.

## Verify before building

Check the current externals list, the Node version range in `node-runtime.json`, and whether the
standalone entry still reads the environment variables named here. Check that the provider offers
raw TCP passthrough in the chosen region.
