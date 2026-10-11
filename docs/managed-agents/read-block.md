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
  and its own skill folders. The task CLI uses the token file and the certificate.
- Can write only in its worktree, a temporary folder, and the repository's shared `.git` folder,
  which a commit from a worktree writes to.
- Reach the network through Claude Code's proxy. The Node's own address is allowed. In
  skip-permissions mode other hosts are allowed too. In other modes Claude Code decides per host, as
  its sandbox documentation describes.
- Can't rerun a refused command outside the sandbox, because `allowUnsandboxedCommands` is off.
  Without that, a skip-permissions session could retry any blocked command unconfined.

Claude's own Read and Edit tools run outside the sandbox, so deny rules keep them out of every data
folder entry that holds nothing the session works in. The Edit rules also stop the agent planting a
file there, such as a `.env` the helper would load at the next start.

If the machine can't run the sandbox, for example Linux without `bubblewrap`, the session fails to
start rather than running unconfined.

## What stops working

- Installs that write outside the worktree, such as `pnpm install` writing to its package store.
- `git push` over SSH, when the sandbox blocks the `ssh-agent` socket.
- Any tool that writes to a folder in your home directory, such as a cache.

Turn the switch on for work you don't trust, such as agents reading issues and pull requests from
outside contributors, and leave it off for work that needs those tools.

## What it doesn't cover

- The agent's own token, which reaches only its own task.
- Other worktrees, when the data folder holds them, which a development checkout does. Claude's file
  tools can still read them, though its shell can't.
- Anything outside the data folder that your user can read.

For the rest of the model, see
[what task scope does and doesn't protect against](../security.md#what-task-scope-does-and-doesnt-protect-against).
