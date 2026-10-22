---
title: Where your data lives
description: The folder a Node keeps everything in, what each file in it holds, and what your device keeps instead.
sources:
  - docs/data-layer/data-root.md
  - docs/state-ownership.md
  - docs/notes-and-memory.md
  - docs/data-layer/backup-and-retention.md
  - docs/tui/process.md
  - packages/custody/src/local/paths.ts
  - plugins/memory/src/server/memory.ts
checked: '9aaaaf7d3'
---

Everything a Node knows is in one folder on its machine, its data folder. Your device keeps a few things
of its own, in a separate place. This page lists both, for when you want to back up, move, inspect, or
clean up.

## The data folder

| Node | Its data folder |
| --- | --- |
| The desktop app's, on macOS | `~/Library/Application Support/com.acorn.desktop/node` |
| The desktop app's, on Windows | `%APPDATA%\com.acorn.desktop\node` |
| A standalone Node | The folder `ACORN_DATA_DIR` names |
| acorn run from a checkout | `apps/node/.acorn` in the checkout |

The folder is readable only by the user the Node runs as, and only one Node can use it at a time. A
second one that tries is refused.

## What's in it

| File or folder | What it holds |
| --- | --- |
| `core.sqlite` | Workspaces, projects, and tasks. Paired devices. Connections such as GitHub, with their credentials encrypted. Configuration you trusted, schedules, and the audit log. |
| `plugins/<plugin>.sqlite` | One database for each plugin that stores data, named after it. `agents.sqlite` holds agent sessions and their transcripts, and `workflows.sqlite` holds workflows and their runs. |
| `plugins/<plugin>/` | Plugins installed as packages. |
| `worktrees/` | Task worktrees. Each is an ordinary Git checkout. |
| `notes/` | Notes, as Markdown files you can read or edit by hand. |
| `blobs/` | Files acorn fetched and can fetch again, such as from GitHub. |
| `tls/` | The Node's certificate and its private key. |
| `logs/` | The Node's logs. |
| `node.json` | The Node's ID, when it was made, the last port it used, and the address answer from its first start. |
| `node.lock` | Says a Node has the folder open. |
| `node-keys.sealed` | The desktop app's Node only: its keys, sealed with a key in the operating system's keychain. |
| `session.key`, `internal-token` | A standalone Node only: its keys, unless you set `SESSION_ENC_KEY`. |
| `login-shell-path.json` | The desktop app's Node on macOS only: the `PATH` your login shell last reported, so the Node can start tools without waiting for the shell. It stays on this machine. |

**Settings** > **Machines** > **Storage and memory** shows how much space each database and the blob
cache take, for the Node the header names. Worktrees aren't counted.

Memory isn't in the data folder for the desktop app's Node. Agents keep it as Markdown files in
`~/.acorn/memory` on the Node's machine. A standalone Node keeps it in `memory/` in its data folder.

Two files outside the data folder are yours to write, on the Node's machine: `~/.acorn/config.toml` and
the workflows in `~/.acorn/workflows/` ([Configuration files](/docs/reference/configuration-files/)).

## What your device keeps

Your device keeps what's about you and this device, not the work:

| Client | Where | What |
| --- | --- | --- |
| The desktop app | `~/Library/Application Support/com.acorn.desktop/` on macOS, and `%APPDATA%\com.acorn.desktop\` on Windows | `acorn.json` with appearance, shortcuts, and the rail ([Configuration files](/docs/reference/configuration-files/#the-device-config-file)). The Nodes it's paired with, their certificates, and its tokens, encrypted. A cached copy of what it read from each Node. |
| The terminal client and the command line | Their config folder: `~/Library/Application Support/acorn` on macOS, `%APPDATA%\acorn` on Windows, and `~/.config/acorn` on Linux | The Nodes they're paired with and a token for each, readable only by you. The terminal client's cached copy and its `acorn.json`. |

The cached copy is only for speed and for showing something while a Node is offline. Deleting it loses
nothing: **Clear this node's copy** in **Settings** > **Machines** > **Storage and memory** does it for
one Node.

## In the terminal

The terminal client and the command line use the same data folder as the desktop app when the desktop
app is installed, and `ACORN_DATA_DIR` when you set it.

## Limits

- Deleting rows doesn't make a database file smaller. The space is reused, but the file doesn't shrink.
  To get it back, stop the Node and run SQLite's `VACUUM` on the file.
- Nothing cleans up the blob cache, so it can grow large. Everything in it can be fetched again.
