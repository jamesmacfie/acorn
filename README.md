# acorn

acorn is an agent workspace. You group projects into workspaces, open a task for each piece of work,
and run coding agents, terminals, and review panes inside that task, each in its own Git worktree. It
has a desktop app, a terminal client, a headless command-line client, and a tree of plugins.

Agents read [AGENTS.md](./AGENTS.md) first. Everyone else starts at [docs/README.md](./docs/README.md),
which indexes every doc.

## What it does

- **Workspaces and tasks.** Workspaces group projects. A task is work on one project and can own a
  branch, a worktree, a linked pull request or issue, panes, terminals, and agent sessions.
- **Agents.** The Agent pane and Agent Center run Claude Code and Codex sessions with normalized
  transcripts, approvals, artifacts, usage, and search. The terminal drawer runs shells, Aider, and
  raw provider sessions.
- **Task panes.** Pull-request review, changes, notes, context, editor, search, preview, Docker,
  database, HTTP requests, Linear, and Rollbar.
- **GitHub review.** Diffs, comments, reviews, labels, reviewers, checks, and Actions logs.
- **Workflows.** Orchestration defined in a file or in the app, with durable run state, gates,
  budgets, branching, and joins.
- **Settings.** A full-window, searchable place for connections, model providers, agents, MCP,
  terminals, Docker, workflows, Nodes, plugins, security, and appearance.
- **The `acorn` command.** With no arguments it opens the terminal client. With a subcommand it runs
  headless commands against a paired Node. See [CLI](./docs/cli.md).

[Features](./docs/features.md) describes each surface.

## How it runs

The desktop app is a SolidJS renderer inside a Tauri shell, built for macOS and Windows. A small Rust
shell owns the window and supervises a Node helper process, which starts `apps/node` as a child under
the bundled Node runtime. Each Node owns its data root, integrations, worktrees, terminals, agents,
workflows, and processes. The desktop can manage the bundled local Node and any other Node paired to
the same installation.

A Node serves only `/v1` over HTTPS with TLS 1.3 on loopback: core routes under `/v1/core/*`, plugin
routes under `/v1/p/<plugin>/*`, and the event and stream socket at `/v1/events`. It serves no web
assets. The renderer loads from the shell's `app://acorn` scheme, holds no tokens or certificates, and
reaches Nodes through the helper's connection broker. [Architecture overview](./docs/architecture-overview.md)
has the full picture.

## Run a Node in Docker

Each release publishes a Linux x64 image of the standalone Node to `ghcr.io/jamesmacfie/acorn-node`.
It runs anywhere Docker does, including a Mac too old for the macOS archive, which needs macOS 13.5.
The image includes Git, tmux, ripgrep, and the `claude` and `codex` commands, so agents run inside the
container and the machine needs neither installed.

Save this as `compose.yaml`. Change `homelab.local` to the name other machines use to reach this one,
and `~/Projects` to the folder that holds your repositories.

```yaml
services:
  acorn-node:
    image: ghcr.io/jamesmacfie/acorn-node:latest
    restart: unless-stopped
    ports:
      - "4317:4317"
    environment:
      ACORN_ADVERTISE_HOST: homelab.local
    volumes:
      - acorn-data:/data # the Node's keys, database, and paired devices
      - acorn-home:/home/acorn # Claude and Codex logins, Git settings, and SSH keys
      - ~/Projects:/projects
volumes:
  acorn-data:
  acorn-home:
```

Keep the port the same on both sides, because the Node checks it in every request. To use another
port, change both numbers and set `ACORN_PORT` to match.

1. Start the Node: `docker compose up -d`.
2. Read the pairing code and the six identity words: `docker compose logs acorn-node`.
3. In the desktop app, open **Settings > Nodes**, add `https://homelab.local:4317`, check the words
   match, and enter the code. The code lasts 10 minutes. For a fresh one, run
   `docker compose kill -s USR1 acorn-node`, then read the logs again.
4. Sign in to the agents once, inside the container: `docker compose exec acorn-node claude`, and
   `docker compose exec acorn-node codex login --device-auth` for Codex.
5. Add projects from `/projects`. For Git to push, set your name and email, and add an SSH key, in
   the same way: `docker compose exec acorn-node bash`.

To upgrade, run `docker compose pull`, then `docker compose up -d`. Both volumes stay, and the Node
migrates its data when it starts. On macOS, set Docker to start at login, or the Node won't come back
after a restart.

## Repository layout

```text
apps/desktop/          Rust shell, desktop helper, renderer bridge, renderer, and packaging
apps/cli/              Headless command client and the shared acorn launcher
apps/tui/              Interactive terminal client
apps/node/             Node composition roots, standalone entry, plugin activation, and integration tests
packages/protocol      Wire contracts and route and query builders
packages/node-core     Node server, auth, storage, core services, MCP, and shared registries
packages/client-core   Renderer runtime, fleet state, persistence, registries, settings, and UI kit
packages/plugin-api    The only host import surface for loaded plugins
plugins/*              First-party feature packages
tools/arch/            Architecture and documentation checks
```

First-party packages are consumed as TypeScript source through their exports maps, and imports
across packages use the real `.ts` extension. `apps/desktop` embeds the built Node artifact and never
imports Node source.

Most first-party plugins are compiled into the app. agent-cost, database, HTTP, Linear, model
providers, Rollbar, and Sentry telemetry ship as loaded plugins instead. They're bundled with the
app, installed like third-party plugins, and import the host only through `@acorn/plugin-api`.
[Plugins](./docs/plugins.md) explains the two tiers.

## Develop

You need Node in the range the root `package.json` allows, pnpm 11, and a Rust toolchain. The desktop
bundle and the tests use the Node version pinned in `node-runtime.json`.

```sh
pnpm install --frozen-lockfile
pnpm rebuild:node
pnpm dev
```

Other commands you'll use:

```sh
pnpm dev:node                              # standalone Node, no desktop window
pnpm dev:agent -- --session <name>         # isolated desktop session you can drive
pnpm dev:plugin <id>                       # rebuild one loaded plugin's package on every save
pnpm --filter @acorn/cli build             # headless CLI bundle for node apps/cli/bin/acorn.mjs
pnpm lint                                  # oxlint, the formatter check, then TypeScript checks
pnpm format                                # format every TypeScript file with oxfmt
pnpm test                                  # native rebuild, then every Vitest suite
pnpm db:check                              # replay every SQLite migration chain
pnpm dist                                  # build and package the desktop app
pnpm pack:node                             # build the standalone Node tarball
```

GitHub connects with acorn's public client ID, so development needs no environment file.
[Local development](./docs/local-development.md) covers the optional `.env`, the native module, the
database commands, and the dev loops. [Testing](./docs/testing.md) covers the test commands.

Designs for work that hasn't shipped live under [docs/future/](./docs/future/README.md).
