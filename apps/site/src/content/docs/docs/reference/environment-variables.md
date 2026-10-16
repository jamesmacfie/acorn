---
title: Environment variables
description: The environment variables you can set for the Node, the command line, and the terminal client, and the ones acorn sets for processes in a task.
sources:
  - docs/node-distribution.md
  - docs/tui/process.md
  - docs/cli.md
  - docs/cli/workspaces-projects-tasks.md
  - docs/notifications/channels.md
  - apps/site/scripts/envVars.mjs
  - apps/node/src/entries/standalone.ts
  - packages/node-core/src/server/transport/listenerConfig.ts
  - packages/node-core/src/server/transport/advertise.ts
  - packages/node-core/src/server/taskEnv.ts
  - packages/custody/src/local/paths.ts
  - apps/tui/src/kit/notify.ts
  - apps/tui/src/kit/copy.ts
  - apps/tui/src/keys/install.ts
checked: 07aa959a0
---

This page lists every environment variable acorn reads that you might set, and the ones acorn sets for
the processes it starts in a task. It's for anyone running a [standalone
Node](/docs/nodes/run-a-standalone-node/), scripting the [command line](/docs/automation/the-command-line/),
or writing a [task script](/docs/using/task-scripts/).

## The Node

| Variable | What it does |
| --- | --- |
| `ACORN_DATA_DIR` | The folder the Node keeps everything in ([Where your data lives](/docs/nodes/where-your-data-lives/)). Without it, the command line and the terminal client use the desktop app's folder when the app is installed, and a checkout's `apps/node/.acorn` when they run from one. A Node unpacked from the archive has neither, so set it. |
| `ACORN_PORT` | The port the Node listens on. With it set, the Node uses that port or fails to start. Without it, the Node takes the port it used last time if it's free, or any free port. |
| `ACORN_ADVERTISE_HOST` | The addresses other machines reach the Node at, separated by commas, such as `192.168.1.20,build.local`. With it set, the Node listens on every interface and answers those names and loopback. It wins over the answer the Node recorded on its first start ([Pair a device or a remote Node](/docs/nodes/pair-a-device-or-a-remote-node/#let-other-machines-reach-the-node)). |
| `ACORN_BUNDLED_PLUGINS_DIR` | A folder of built plugin packages a standalone Node installs and keeps up to date at every start, the way the desktop app does with the plugins it ships. For running from a checkout. |
| `ACORN_PERF` | `1` prints each request's timing, and timing tables for Git and the databases, to the Node's error output. `kill -USR2 <pid>` prints the tables again. |
| `ACORN_DEVICE_TOKEN` | A device token a launcher already holds. A standalone Node started in a terminal prints it back in its first line while it's still valid, instead of making a new one. |
| `SESSION_ENC_KEY` | The 64-character hexadecimal key the Node encrypts stored credentials with. Without it, a standalone Node makes one and keeps it in `session.key` in its data folder. |
| `GITHUB_CLIENT_ID` | The GitHub OAuth app the Node signs in with, in place of acorn's own. |

## The terminal client and the command line

| Variable | What it does |
| --- | --- |
| `ACORN_DATA_DIR` | Which Node's folder `acorn` attaches to, or starts a Node in. The same variable as above. |
| `ACORN_TUI_CONFIG_DIR` | Where the terminal client and the command line keep the Nodes they're paired with, their device tokens, and the terminal client's saved cache and settings. Without it: `~/Library/Application Support/acorn` on macOS, `%APPDATA%\acorn` on Windows, and `$XDG_CONFIG_HOME/acorn` or `~/.config/acorn` on Linux. |
| `ACORN_TUI_NOTIFY` | How the terminal client gets your attention: `off`, `bell`, `terminal` for the terminal's own notification, or `both`, the default. **Settings** > **General** > **Notifications** shows what it chose. |
| `ACORN_TUI_OSC52` | `1` lets copy buttons write to the clipboard through your terminal, and `0` stops them. Without it, acorn decides from `TERM` and `TERM_PROGRAM`. |
| `ACORN_TUI_KEYS_TRACE` | Any value logs every key the terminal client hears, and what answered it, to `$XDG_STATE_HOME/acorn/keys.log` or `~/.local/state/acorn/keys.log`. For reporting a key that does nothing. |

## Set for processes in a task

acorn sets these for the terminals, task scripts, agents, and workflow commands it runs in a task.
Read them in a script, and don't set them yourself.

| Variable | What it holds |
| --- | --- |
| `ACORN_TASK_ID` | The task's ID. |
| `ACORN_TASK_TITLE` | The task's title. |
| `ACORN_WORKTREE_PATH` | The folder the process runs in: the task's worktree, or the project folder for a task with no branch. |
| `ACORN_PROJECT_ID` | The project's ID. |
| `ACORN_PROJECT_NAME` | The project's name. |
| `ACORN_REPO` | The repository's path on its code host, such as `owner/name` or `group/subgroup/name`, when the project has a remote. On GitHub it keeps the owner's and name's capital letters. |
| `ACORN_REPO_HOST` | The repository's code host, such as `github.com` or `gitlab.com`, when the project has a remote. |
| `ACORN_BRANCH` | The task's branch, when it has one. |
| `ACORN_TASK_SLUG` | The branch as a short name that's safe in a file name or a container name, when the task has a branch. Use it to keep two tasks' ports, databases, or containers apart. |

Agents and the commands they run also get the credentials for reaching the Node on behalf of that
task. The [command line](/docs/automation/the-command-line/#inside-a-task) reads them, so `acorn task
scripts status` works in a task's terminal with no pairing.

| Variable | What it holds |
| --- | --- |
| `ACORN_API_URL` | The Node's address on this machine. |
| `ACORN_API_TOKEN`, `ACORN_API_TOKEN_FILE` | A token limited to this task, or the file holding it, which the Node renews while the process runs. |
| `ACORN_SESSION_ID` | The agent session the process belongs to. |
| `ACORN_NODE_ID` | The Node's ID, which the command line checks before it sends the token. |
| `ACORN_DATA_DIR` | The Node's data folder. |

## Limits

- The terminal client reads `ACORN_TUI_NOTIFY` once, when it starts.
- The desktop app ignores `ACORN_DATA_DIR`. Its Node always uses the app's own folder. The `acorn`
  command that **Settings** > **General** > **Command line** installs sets `ACORN_DATA_DIR` to that
  folder, unless you set it first.
