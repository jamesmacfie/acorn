# Phase 1: keep agents away from client device tokens

## Completion note

Done on October 22, 2026.

What landed:

- `appDataDir`, `configDir`, and `desktopDataRootDir` moved into
  `packages/node-core/src/server/transport/listenerConfig.ts`. Custody re-exports `configDir` and
  `desktopDataRootDir`, so no caller changed. A new `clientCustodyDirs(dataDir)` there lists the
  folders to block, and `@acorn/plugin-api/node` exports it for the agents runtime.
- `dataRootReadBlock` takes `clientDirs`. The file guard protects every one of them, including a
  folder that doesn't exist yet, so tokens a client writes after the start are covered. The sandbox's
  `denyRead` gets each existing folder whole (`clientReadDenied`). Their entries join `hidden`, which
  feeds the `Read` and `Edit` deny rules, the same way the data root's do.
- The CLI's environment check has a comment saying it isn't a boundary. The read block doc, the CLI
  task doc, and the credentials doc say the same, and credentials names keychain sealing as the
  follow-up. Four public site pages changed to match, and every page citing a touched file is marked.
- Tests: a client folder case in `readBlock.test.ts`, and `packages/custody/src/local/paths.test.ts`
  for `ACORN_TUI_CONFIG_DIR`.

Decisions and deviations:

- The desktop folder in the list is wrong for a development build. Its `data.key` lives in the
  custody root beside the Node's root, `<data root>-shell` (`development_custody_root` in the desktop
  crate), not in `com.acorn.desktop`. `clientCustodyDirs` lists both.
- A client folder that holds the worktree or the data root isn't denied whole, because that would
  stack a second deny above paths the sandbox opens again, which I couldn't check on Linux. The
  sandbox denies its entries beside them instead, and the file guard still covers the whole folder.
  That's always the case for the installed desktop's folder, so its `data.key` and `fleet.json` are
  blocked, but one created there after a session starts is caught only by the file guard.
- Each folder is listed as the Node's environment spells it and as the platform default, because a
  client started from another shell may have had a different `XDG_CONFIG_HOME` or `APPDATA`.
- An installed desktop Node's custody root is also read from its own data root, the parent of
  `com.acorn.desktop/node`. On Linux, Tauri puts that under `~/.local/share`, which `appDataDir`
  doesn't name. The same mismatch means `desktopDataRootDir()` and `dataRootDir()` miss an installed
  desktop on Linux. That's older than this phase and I left it alone.
- **Check this node** reports only the switch and the harnesses, not folder coverage, so the
  diagnostics test didn't change.
- The file guard's refusal still says "Acorn's data folder" for a client folder. That matches the
  switch's name, so I left it.

For later phases:

- The `pnpm dev:agent` walk in Acceptance didn't run here. This session runs inside a sandbox, so a
  nested Claude Code sandbox can't start. Phase 6 should walk it: `cat` of `device-token-local`, the
  `env -u` CLI run, and `acorn task scripts status`, with the switch on and off.
- A client folder that doesn't exist when a session starts is left out of the sandbox, as this doc
  asked, and only the file guard covers it until the next start or resume. That matters only when
  the owner pairs a first client of that kind during a running session. Phase 6 could check whether
  Claude Code's sandbox accepts a missing path on Linux; if it does, denying every folder whole
  closes this.
- The Node service bundle measured 1,937,799 bytes against the 1,939,000 ceiling after this change.

Date: October 22, 2026. Status: done. Severity: high.

Every client except the desktop keeps the owner's device token as a plain file. An agent runs as the
same OS user, so one `cat` turns its task token into the owner's device token, which passes every
devices-only gate. **Keep agents out of Acorn's data folder** is the one control that could stop this,
and it doesn't cover the folder the tokens are in. This phase makes the switch cover it. Read
[the programme](./README.md) first.

## Starting point

Read at `47287b67c`.

- `custody()` in `packages/custody/src/local/public.ts` stores tokens through `fileModeOnly`, a cipher
  that passes bytes through unchanged. Its default folder is `configDir()` from
  `packages/custody/src/local/paths.ts`: `ACORN_TUI_CONFIG_DIR`, or `acorn` under the platform's app
  data folder, which is `~/Library/Application Support/acorn` on macOS.
- Four clients use it. The CLI and the terminal client write `device-token-local` there. The phone
  gateway writes `mobile/acorn-1-device-token-local` (`apps/mobile/src/gateway/main.ts`). The browser
  bridge writes one folder per browser under `browser-bridge/` (`apps/cli/src/browser/hostInstall.ts`).
  On the reviewer's machine, all of these existed. [Where the TUI keeps
  things](../../tui/process.md) says the token is plain bytes at `0600`, and
  [node plugin security](../../security/node-plugin-security.md) says any process running as the user
  can read it.
- The desktop's tokens are encrypted with the keychain, but a development build keeps `data.key` in
  plain form in the desktop's own folder, `com.acorn.desktop` under the app data folder. That's R21.
  The desktop's data root is the `node` folder inside it.
- [The read block](../../managed-agents/read-block.md) denies the Node's data root and nothing else.
  `dataRootReadBlock` in `plugins/agents/src/server/drivers/readBlock.ts` takes one `dataDir`, and
  `claudeReadBlockSettings` in `plugins/agents/src/server/drivers/claudeHarness.ts` writes it as
  `denyRead: [block.dataDir]`. Its `network` setting allows only the Node's loopback address, which is
  all a stolen device token needs.
- The CLI decides it's inside a task by reading `ACORN_TASK_ID` and `ACORN_API_TOKEN`, in
  `apps/cli/src/main.ts` and `openCliNode` in `apps/cli/src/node.ts`. With both unset, it opens
  `custody()` and uses the plain token. So `env -u ACORN_TASK_ID -u ACORN_API_TOKEN acorn ...` from an
  agent's shell runs any CLI command as the owner.
- The task CLI an agent is meant to use reads only `ACORN_API_TOKEN_FILE` and `NODE_EXTRA_CA_CERTS`
  (`openTaskConnection` in `packages/custody/src/broker/taskConnection.ts`). It never reads
  `configDir()`.

## Changes

### Deny the client folders in the read block

1. Move `appDataDir`, `configDir`, and `desktopDataRootDir` from `packages/custody/src/local/paths.ts`
   into node-core, beside `devDataDir` in `packages/node-core/src/server/transport/listenerConfig.ts`,
   which custody already imports. Re-export them from custody so no caller changes. Custody depends on
   node-core, so the reverse import would loop.
2. Give `dataRootReadBlock` a list of extra folders to deny, and pass it wherever `options.dataDir`
   reaches the agents runtime (`runtimeEngine.ts`, the `readBlock` option). The list is:
   - `configDir()` computed without `ACORN_TUI_CONFIG_DIR`, the default client folder.
   - `ACORN_TUI_CONFIG_DIR`, when the Node's environment sets it.
   - The desktop's folder, the parent of `desktopDataRootDir()`, which holds `data.key` in a
     development build.
3. In `claudeReadBlockSettings`, add the list to `denyRead` and to the `Read` and `Edit` deny rules the
   file guard uses, the same way `block.dataDir` is handled. Skip a folder that contains the task's
   worktree, so a project kept inside one of these folders still works. Skip a folder that doesn't
   exist.
4. In [the read block](../../managed-agents/read-block.md), add one line to what a blocked session
   can't read: the client config folder, where the CLI, the terminal client, the phone gateway, and the
   browser bridge keep their device tokens.

Why deny the whole folder rather than the token files: the folder also holds the fleet file, the
browser bridge's per-browser folders, and the gateway's phone sessions, and none of them is something
an agent needs. A rule per file would miss the next one someone adds.

Why this doesn't break the task CLI: it reads only its own token file and the Node's certificate,
which stay readable.

### Say what the CLI's task check is

The environment check in `apps/cli/src/main.ts` stops a person running the wrong command in a task
terminal. It can't stop an agent, and with the read block on it doesn't need to. Change its comment
to say so, and say the same in [workspaces, projects, and
tasks](../../cli/workspaces-projects-tasks.md), where task-scoped launches are described. Don't add
another check that reads the environment: an agent controls that too.

### Name the follow-up

Add one line to [credentials](../../security/credentials.md) saying client tokens are plain files, the
read block is what keeps agents from them, and sealing them with the platform keychain is the
follow-up. Don't build that in this phase. The CLI and the gateway also run on Linux and beside a
standalone Node, where there's no keychain to use.

## Tests

- In `plugins/agents/src/server/drivers/readBlock.test.ts`, a case that passes extra folders and
  checks they appear in `denyRead` and in the deny rules, that a folder holding the worktree is
  skipped, and that a missing folder is skipped.
- A case in the custody path tests that `configDir()` still honors `ACORN_TUI_CONFIG_DIR` after the
  move.
- The security diagnostics test, if **Check this node** reports the read block's coverage, gains the
  client folder.

## Acceptance

- In `pnpm dev:agent` with the switch on, an agent's `cat` of `device-token-local` under the client
  folder fails, and so does `env -u ACORN_TASK_ID -u ACORN_API_TOKEN acorn task list`.
- The same agent's `acorn task scripts status` still works.
- With the switch off, nothing changes. That's R13 and stays the owner's decision.
