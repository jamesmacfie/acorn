# Keeping agents out of the data folder

An agent runs shell commands as your OS user, so it can read anything in Acorn's data folder: every
session's token file, the task database, and the Node's TLS private key. A prompt-injected agent in
one task can use another session's token to act in that task. **Keep agents out of Acorn's data
folder**, under Settings > Security and backup > **Agent access to Acorn data**, stops that for the
harnesses that can enforce it. It's off by default, because it also limits where an agent can write.

`plugins/agents/src/server/drivers/readBlock.ts` works out what a session may still reach, and
`claudeReadBlockSettings` in `plugins/agents/src/server/drivers/claudeHarness.ts` turns that into
Claude Code's settings. The switch is the `blockDataRootReads` field of the
[new-session defaults](./defaults.md).

## Which harnesses support it

Only Claude Code. It runs shell commands inside its own sandbox, which can refuse reads of a path.
Codex and contributed harnesses can't block a path, so their agents can read the whole data folder
whether the switch is on or not. **Check this node** says which harnesses support the block and
whether a selected session runs with it ([security diagnostics](../security/security-diagnostics.md)).

## What a blocked session can reach

The block applies from each session's next start, because Acorn sends it in the flag settings Claude
Code starts with. A session that's already running keeps how it started. Acorn writes nothing to your
own Claude settings files.

A blocked session's shell commands, and every process they start:

- Can't read the data folder, except its own worktree, its own token file, the Node's certificate,
  and its own skill folders. The task CLI uses the token file and the certificate. A hard link from
  the data folder into the worktree fails too, because the sandbox checks the source path.
- Can write only in its worktree, a temporary folder, and the parts of the repository's `.git`
  folder a commit from a worktree writes. The files that make git run a program or read a different
  repository stay unwritable: `config`, `config.worktree`, `hooks`, `modules`, each worktree's
  `commondir`, `gitdir`, and `config.worktree`, and the worktree's own `.git` file. The Node runs git
  in the worktree unsandboxed for every status refresh, so a hook, an `fsmonitor` setting, or a
  submodule's config written there would run as you. Every entry is a concrete path, because on Linux
  the sandbox skips a write entry with a wildcard. A worktree created after the session starts is
  covered only by Claude Code's own protection, which refuses its `commondir` on macOS. A session
  working directly in a repository's main checkout, with a plain `.git` folder, can't write that
  folder at all, because a rename of it couldn't be stopped otherwise.
- Reach the network through Claude Code's proxy. The Node's own address is allowed. In
  skip-permissions mode other hosts are allowed too. In other modes Claude Code decides per host, as
  its sandbox documentation describes.
- Can't rerun a refused command outside the sandbox, because `allowUnsandboxedCommands` is off.
  Without that, a skip-permissions session could retry any blocked command unconfined.

A blocked session's task token stops at write tools, whatever its own ceiling allows. Every
execute tool, such as a run target, a workflow, a delegated agent, or the browser, runs outside the
sandbox, so allowing one would let the agent run a command the block can't see
([execution routes](../security/transport-and-auth.md#execution-routes)).

If the machine can't run the sandbox, for example Linux without `bubblewrap`, the session fails to
start rather than running unconfined.

### Claude's own file tools

Claude's own file tools, such as Read, Write, Edit, Glob, and Grep, run outside the sandbox. A
PreToolUse hook runs Acorn's file guard before each call (`packages/node-core/src/mcp/fileGuard.ts`,
built as `file-guard.js` beside `mcp.js`). The guard resolves every link in the target, and resolves a
file that doesn't exist yet through its folder, then checks that real path against the session's
allowlist:

- Inside the data folder, a read must fall within the session's worktree, its skill folders, its own
  token file, or the Node's certificate. A write must fall within the worktree or the git folders a
  commit writes.
- The git files listed above can't be written, inside the data folder or not.
- A search can't start from a folder that holds the data folder.

So a `.env` created in the data folder after the session started is refused, as is a write reached
through a link in the worktree. The guard decides from the policy on its command line and never asks
the Node. It refuses a call when it can't read its policy or the call, because Claude Code reads exit
code 2 as a refusal. A Node that has no guard program, such as a standalone Node, refuses to start a
blocked session.

Deny rules for the entries present at the start stay in Claude's own permission settings too, so
Claude's check and the guard each cover them.

## What stops working

- Execute tools, including run targets, workflow runs, delegated agents, and the browser tools.

- Installs that write outside the worktree, such as `pnpm install` writing to its package store.
- Git commands that change the repository's settings or submodules, such as `git config`,
  `git push -u`, and `git submodule update`.
- Commits from a session working in a main checkout rather than a task worktree.
- `git push` over SSH, when the sandbox blocks the `ssh-agent` socket.
- Any tool that writes to a folder in your home directory, such as a cache.

Turn the switch on for work you don't trust, such as agents reading issues and pull requests from
outside contributors, and leave it off for work that needs those tools.

## What it doesn't cover

- The agent's own token, which reaches only its own task.
- Anything outside the data folder that your user can read.

For the rest of the model, see
[what task scope does and doesn't protect against](../security.md#what-task-scope-does-and-doesnt-protect-against).
