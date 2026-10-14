# Phase 2: test against a Node on a different filesystem

Date: October 14, 2026. Status: proposed. Depends on [phase 1](./01-standalone-plugins.md).

## Goal

Give developers and agents one command that starts a Node whose filesystem and network differ from
the client's, and pairs a development desktop to it. Use it for every "remote Node" check, so code
that assumes one machine fails where people can see it.

## Starting point

- `docs/testing/smoke-checklist.md` and `docs/testing/settings.md` ask for a second paired Node. In
  practice it runs on the same Mac, so a path picked on the client exists on the "remote" Node too.
- 17 test files model a Node with `local: false`. They cover gating logic, not real paths.
- [Cloud phase 1](../cloud/phases/01-node-image.md#1-write-the-image) designs a container image for
  the standalone Node, with the loaded plugins inside it.

## Changes

1. Build the image from cloud phase 1, step 1. This phase needs only its local Docker half: no
   provider, no CI publishing. If cloud phase 1 has shipped, use its image as is.
2. Add a root script that starts the container with a throwaway data volume, a fixed port, and
   `ACORN_ADVERTISE_HOST` set. It then pairs a `pnpm dev:agent` session to it with the pairing code
   from the container's banner. Print the Node ID and label so a driver script can select it.
3. Seed one project inside the container: a small Git repository under a path that doesn't exist on
   macOS, such as `/srv/projects/sample`.
4. Change the second-Node steps in the two testing checklists to use this script, and say why a
   second process on the same machine isn't enough.
5. Document the script in `docs/local-development.md`.

## Out of scope

Running the rig in CI on every pull request. Start with a manual and agent-driven check, and decide
on CI after it has caught something.

## Acceptance

- One command starts the container Node and leaves a desktop session paired to it.
- On that Node, the seeded project opens, a terminal runs inside the container, and a managed agent
  turn completes if credentials are supplied.
- Before phase 3 lands, **Change folder…** on the seeded project reproduces the path bug. After phase
  3, it doesn't. Record both results in this file.

## Risks

`node-pty` needs a Linux build inside the image. Cloud phase 1 already accounts for it. Agent
credentials don't belong in the image. Pass them as runtime environment variables and say so in the
script's help.
