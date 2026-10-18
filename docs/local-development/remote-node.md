# Test against a remote Node

`pnpm dev:remote` starts a Node in a Linux container and pairs a desktop window to it. Use it for
every check that involves a remote Node.

A second Node started on the same Mac isn't enough. It shares the client's filesystem, network, and
build, so a path picked on the client exists on that Node too, and a `localhost` address reaches it.
Code that assumes the client and the Node are one machine passes there and fails for a real remote
Node. In the container, the paths, the operating system, the user, and the loopback all differ.

## Start it

Docker must be running. Then run:

```sh
pnpm dev:remote -- --session remote-check
```

The script does the following:

1. Runs `pnpm pack:node` and builds the `acorn-node` image from `apps/node/Dockerfile`.
2. Starts the `acorn-remote-node` container on `https://localhost:4317` with a throwaway data volume
   and `ACORN_ADVERTISE_HOST=localhost`. A container left from an earlier run is replaced.
3. Pairs itself as a device named `remote rig` with the code from the container's pairing banner. The
   container's output carries no device token.
4. Creates a Git repository at `/srv/projects/sample` inside the container, a path no Mac has, and
   adds it as a project with the `remote rig` token.
5. Starts `pnpm dev:agent -- --session remote-check`, opens a new pairing code with the `remote rig`
   token, and pairs that window to the container Node through the same probe and pair calls that
   Settings > Nodes makes. It checks that the certificate the window reached is the one the
   container's handshake named.
6. Prints one JSON line with `nodeId`, `label` (`Container Node`), `endpoint`, `projectId`, and
   `projectPath`, for a driver script to select the Node and project.

Then drive the window with `pnpm dev:agent:ui -- --session remote-check`, as
[agent drivers](./agent-drivers.md) describes. Pick **Container Node** in the top bar's Node menu.
Use a new session name for each run, because the paired Node exists only as long as the container.

Stop the window with `pnpm dev:agent:ui -- --session remote-check stop`, or press Ctrl-C. Either way
the script stops the container, and Docker deletes its data volume.

## Agent credentials

The image holds the `claude` and `codex` CLIs and no credentials. To run a managed agent turn in the
container, export any of `ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`, or `OPENAI_API_KEY` before
you start the script. The script passes each one that's set to the container by name, so the value
never appears in a command line. `pnpm dev:remote -- --help` lists them.

## Pair another client by hand

To pair an installed app or the terminal client instead of a `dev:agent` window, run the image
yourself and pair by code:

```sh
pnpm pack:node
docker build -f apps/node/Dockerfile -t acorn-node apps/node/release
docker run --rm -p 4317:4317 -e ACORN_ADVERTISE_HOST=localhost acorn-node
```

The container prints its pairing banner. In Settings > Nodes, add `https://localhost:4317`, compare
the identity words, and enter the code. Publish the port at the same number, because the Node's
`Host` check compares the port and a remapped port fails with a bare 403.

## The image

`apps/node/Dockerfile` installs the packed tarball as an operator would, on the Node version pinned
in `node-runtime.json`. Its build context is the `release` folder the packer writes beside it. The
build stage compiles `node-pty`, and the runtime stage adds Git, tmux, ripgrep, and the agent CLIs.
The Node runs as the `acorn` user with its data root on the `/data` volume, and the image sets `SHELL`,
because Docker doesn't and terminals start it. The image is the local half of
[cloud phase 1](../future/cloud/phases/01-node-image.md#1-write-the-image).
