# Known key values

The secret detector finds credentials by shape. A database password, a webhook signing secret, or an
internal API key has no documented prefix, so the detector can't see it. The known key index finds
those by value: it knows the keys stored on this machine and looks for their values in agent tool
calls, commits, and pushes. This page covers what the index reads, what it keeps, where it runs, and
what it can't see. [Secret checks before publication](./secret-publication.md) owns the detector and
the blocking switch.

## The index

`packages/node-core/src/server/secretChecks/knownValues.ts` owns the index. It reads these sources:

- The task folder's `.env`, `.env.*`, `*.env`, and `.envrc` files, at the top level only. Names that
  contain `example`, `sample`, `template`, or `dist` are skipped.
- `~/.aws/credentials`, `~/.npmrc`, `~/.netrc`, and `~/.docker/config.json` in your home folder. The
  Node reads these by default.
- The Node's own environment, shown as "Acorn's environment".

It keeps a value only under a secret-looking name such as `API_KEY` or `DB_PASSWORD`, and only when
the value is at least 12 characters, has no white space, isn't a placeholder, a path, a host, or a URL
without a password, and has at least 3.5 bits of entropy per character.

The index holds the key's name and a SHA-256 of its value with a salt drawn at each Node start. It
lives in memory and never holds a value past the read. It rereads a file when its size or
modification time changes, and forgets a task folder after 50 others were looked up more recently.

A lookup cuts text into candidates on shell, JSON, and URL punctuation, decodes URL escapes, and
hashes each candidate. It reads at most 2 MiB of text and says when it stopped early.

Each check takes a matcher for one task folder. The matcher's version is a hash over the salted
hashes and names it holds, so it changes when a key is added, removed, or renamed, and at each Node
start. The Git blob cache and publication allowances bind to it.

## Where it runs

**Every harness, after the fact.** When the event store saves a tool call, it looks up the call's
input against the session's task folder. A match adds the key names and sources to the stored call,
and the tool card in the web and terminal clients shows "This tool call contained
`STRIPE_SECRET_KEY` from .env.local." This stops nothing. Only the input is read, because output can
run to megabytes.

**Claude Code, before the call.** With **Block publication with secret findings** on, the harness
bridge is installed for every Claude Code session, and its `PreToolUse` call looks up the tool's
whole input before any plugin handler runs ([harness bridges](../managed-agents/loop-hooks.md#installation)).
A match on a command, a web fetch, or an MCP tool call is a deny. The model reads this in the same
turn:

> Blocked by Acorn: this command contains the value of `STRIPE_SECRET_KEY` from `.env.local`. Refer
> to the variable instead of its value.

A match on an edit isn't refused, because an agent that writes `.env` writes the value on purpose.
The tool card warning still reports it. A bridge refusal has no allowance: the agent rewrites the
command. A failed lookup is no decision, like the rest of the bridge. Codex, DeepSeek, and
contributed ACP harnesses have no bridge, so they get the tool card warning only. Turning the switch
on reaches a running session after its next resume.

**Commit and push.** The Git checks look up each line of every blob and tag message they read. A
match is a high-confidence `known-value` finding that names the key, which refuses the commit or push
with blocking on and takes the usual one-time allowance
([Git](./secret-publication.md#git)).

## What you see

**Keys Acorn knows about**, under the blocking switch in Settings > Security and backup, lists each
source with its key count and, behind a fold, the key names. It never shows a value. A task folder
appears after an agent in that task has made a tool call since the Node started.

A tool call that carried a known key writes `secrets.agent.carried` to the audit log, with the
session as the subject and the tool call ID and key names as details. No stored tool call, wire
event, finding, log, or audit row holds a key's value.

## Limits

- A key passed by reference, such as `$STRIPE_KEY` or `curl -d @.env`, or read by a script, leaves no
  value in the text, so the index can't see it.
- A long, random value under a secret-looking name, such as a build ID, matches even when it isn't a
  secret. The tool card warning shows these before blocking does.
- The environment source is the Node's own, which holds more than any one harness sees, such as the
  Node's internal tokens.
- Only a task folder's top level is read. A `.env` in `apps/api/` of a monorepo isn't indexed.
