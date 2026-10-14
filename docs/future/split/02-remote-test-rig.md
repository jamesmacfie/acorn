# Phase 2: test against a Node on a different filesystem

## Completion note

Landed October 14, 2026.

What changed:

- `apps/node/Dockerfile` builds the standalone Node image from the packed tarball: a build stage that
  runs `npm ci` (compiling `node-pty`) and the prune step, and a runtime stage on
  `node:24.21.0-bookworm-slim` with Git, tmux, ripgrep, the `claude` and `codex` CLIs, a non-root
  `acorn` user, `/data` as a volume, `ACORN_PORT=4317`, and `SHELL=/bin/bash`.
- `pnpm dev:remote -- --session <name>` (`scripts/remote-node.mjs`) packs, builds the image, runs
  the `acorn-remote-node` container with a throwaway volume, seeds `/srv/projects/sample`, starts
  `pnpm dev:agent`, and pairs the window through `window.acorn.nodeProbe` and `nodePair`. It prints
  one JSON line, then stops the container when the window stops.
- [Remote Node](../../local-development/remote-node.md) documents it, and the smoke and settings
  checklists use the container Node for their second-Node steps.
- `.gitignore` now ignores `apps/node/release/`, which every pack writes.
- The Node service ceiling in `apps/node/scripts/check-service-budget.mjs` went from 1,797,500 to
  1,819,500 bytes, so `pnpm pack:node` passes again.

Decisions and deviations:

- The ceiling is raised, not trimmed. Against an older build in the main checkout, the growth is
  `crossSession.ts` and `crossSessionTools.ts` from commit 3f82204c4, about 21.7 KB, plus a 3 KB
  search chunk. The three cross-session agent tools register at boot, and their input schemas must
  exist then. Moving only the handler logic behind an import would save less than half the overage.
- The image installs a tarball packed on the host instead of running `pnpm pack:node` in a build
  stage, as cloud phase 1 suggested. The tarball is platform-neutral by design, and packing in Docker
  would need the whole monorepo in the build context. A CI build can pack first and then build.
- The image sets `SHELL`. Without it the Node falls back to `/bin/zsh`
  (`packages/node-core/src/server/profiles.ts` and `loginShellPath.ts`), which Debian lacks, so the
  first terminal exited with code 1. That fallback is a macOS assumption in core. It's left for a
  later phase, and the rig hides it now that the image sets `SHELL`.
- The sample repository is created by `docker exec`, not baked into the image, so cloud phase 1 can
  use the same image as is. The project is added through `POST /v1/core/projects` with the
  handshake's launcher token.
- `docs/node-distribution.md` is at the 200-line limit, so the image's description lives on the
  remote Node page. Cloud phase 1 owns the operator-facing container section.
- The rig always packs, which took 34 seconds here, so a check never runs a stale Node.

Checked by hand, with no agent credentials set:

- `pnpm dev:remote -- --session p2-rig2` paired a window to **Container Node**. The seeded `sample`
  project opened. A worktree task created `/data/worktrees/p-sample-rig-check` in the container.
- A terminal in that task ran `/bin/bash` in the container. A command sent through the terminal's
  send route wrote `pwd`, `uname -s`, and `whoami` as the worktree, `Linux`, and `acorn`. The hidden
  `dev:agent` window draws a blank terminal body, because it runs no animation frames.
- A managed agent turn wasn't run, because no credentials were available. `claude` 2.1.299 and
  `codex` 0.162.1 are on the container's `PATH`.
- `docker stop` drained in under a second. Stopping the window removed the container.

**Change folder…** before phase 3: reproduced. On the sample project's General settings, the button
shows for the container Node with no typed path. With the window's `folderPath.pick` replaced to
answer `/Users/jamesmacfie/Source/acorn`, pressing it sent that Mac path to the container Node,
which answered "Directory does not exist." On a second Node on the same Mac the path would have been
accepted. After phase 3: not yet recorded.

For phase 3:

- Start with `pnpm dev:remote -- --session <name>` in the background and wait for the JSON line.
  Select the Node in the top bar's **Active node** menu, or open settings with
  `pnpm dev:agent:ui -- --session <name> link "acorn://<nodeId>/settings/workspaces#projects"`.
- The driver can't open native pickers. To check a picker call, replace `window.acorn.folderPath.pick`
  through WebDriver `execute` with a function that returns a path, as above.
- Calls to the Node API from a script can use the handshake line in `docker logs acorn-remote-node`:
  its `deviceToken` as a bearer token, with `certPem` as the pinned CA.
- Use a new session name each run. A reused one remembers a Node that no longer exists.

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
