# Multiple subscriptions for one harness

Date: October 6, 2026

Status: Research and proposal. Implementation has not started.

This page covers how other tools run more than one Claude Code or Codex subscription on one computer,
and how Acorn could do the same. It's for whoever picks up the feature. It draws on the reference apps
in `references/`, projects on GitHub, and Acorn's agent drivers as of October 6, 2026.

## The problem

Each harness CLI keeps one login per config folder:

- Claude Code keeps its settings, history, and account details in `~/.claude` and `~/.claude.json`. On
  macOS, the OAuth token sits in the Keychain under `Claude Code-credentials`. On other platforms it
  sits in `~/.claude/.credentials.json`.
- Codex keeps everything in `~/.codex`, with the login in `~/.codex/auth.json` unless the user picks
  the OS keyring.

Neither CLI has profiles. Requests for them exist upstream. The Claude Code request,
[anthropics/claude-code#44687](https://github.com/anthropics/claude-code/issues/44687), was closed as
a duplicate. The Codex proposal, [openai/codex#4432](https://github.com/openai/codex/issues/4432), is
open with no maintainer reply.

Both CLIs read an environment variable that moves the whole folder: `CLAUDE_CONFIG_DIR` for Claude
Code and `CODEX_HOME` for Codex. Every approach below builds on one of them. Claude Code 2.1 and later
also scopes the macOS Keychain entry by folder. The entry name gains a suffix: the first eight hex
characters of the SHA-256 hash of the folder path. So two folders hold two logins on macOS too.

## Approaches in the wild

### One config folder per account

Each account gets its own folder, and each launch points the variable at it. The setup is a shell
alias such as `CLAUDE_CONFIG_DIR=~/.claude-work claude`. These use it:

- Community guides, such as the
  [multiple subscriptions gist](https://gist.github.com/mfranceschit/d6091037f0f0db32e38dfe05f8a6a6d7)
  and [Multiple accounts in Claude Code](https://jguillaumesio.com/blog/claude-code-multiple-accounts/).
- [codex-profiles](https://community.openai.com/t/codex-profiles-switch-codex-accounts-without-copying-auth-json/1380415)
  and the [codex-switch](https://github.com/WoozyMasta/codex-switch) VS Code extension.
- Proliferate's agent auth design, in `references/proliferate/specs/systems/agent_auth/README.md`.

Two accounts can run side by side, and neither process can overwrite the other's token. The cost is
that the folder holds more than the login. History, settings, MCP servers, plugins, skills, and memory
live there too, so a second account starts bare.

### One folder, swapped credentials

One folder stays in use, and a switch writes the chosen account's credentials into it. These use it:

- Orca, for Claude Code. See its `claude-accounts` folder in `references/orca`.
- [cx-switch](https://github.com/hairbui76/cx-switch), [codex-account](https://github.com/denysdovhan/codex-account),
  and [CodexAccountSwitcher](https://github.com/aikilan/CodexAccountSwitcher), for Codex.

History and settings stay shared. The catch is token rotation. Both CLIs replace their refresh token
when they refresh, so a saved copy of an account goes stale once the account is used. Orca handles this
with read-back of the refreshed token before every switch, a snapshot of the user's own login, rollback
on failure, and a check for live terminals. That code runs to about 1,800 lines in `runtime-auth/`
alone, with a test suite larger still. Only one account can be active at a time.

### A private login with shared state

Each extra account gets its own folder with its own `auth.json`. Everything else links back to the
main folder. T3 Code calls this a shadow home. See
`references/t3code/apps/server/src/provider/Drivers/CodexHomeLayout.ts`. It links `sessions`,
`archived_sessions`, `sqlite`, `skills`, `plugins`, `cache`, `logs`, and a few others, and keeps
`auth.json` and `models_cache.json` private. Because sessions are shared, T3 Code can move a Codex
thread from one account to another.

Orca does a version of this for Codex. Each account gets its own `CODEX_HOME`, Orca copies
`config.toml` into it, and a background job links older sessions across.

The design works well, but it depends on a list of which files are private to the login. A CLI
release that adds a file can break that list.

### A rotating proxy

A local server sits between the CLI and Anthropic, puts a different account's token on each request,
and switches accounts when one hits its limit. These use it:
[maxpool](https://github.com/2solarmax/maxpool), [CC-Router](https://github.com/VictorMinemu/CC-Router),
[claude-rotate](https://github.com/doxaras/claude-rotate),
[teamclaude](https://github.com/KarpelesLab/teamclaude), and
[claude-proxy](https://github.com/asyncdargen/claude-proxy).

This is the approach that draws account bans. Anthropic started blocking subscription tokens used
outside its own apps in January 2026. In February 2026 it changed its terms to say that using those
tokens in any other product, tool, or service is a breach, and the terms name the Agent SDK in that
list. For more information, see
[Anthropic clarifies ban on third-party tool access](https://www.theregister.com/software/2026/02/20/anthropic-clarifies-ban-on-third-party-tool-access-to-claude/5014546).

### A long-lived token

`claude setup-token` prints a token that lasts a year. A launcher passes it in
`CLAUDE_CODE_OAUTH_TOKEN`, with a per-account `CLAUDE_CONFIG_DIR` so the user's own settings and
`apiKeyHelper` can't override it. Proliferate's design uses this. Nothing needs refreshing. Reports
say some features don't accept this token, which this research didn't confirm.

## Proposal for Acorn

Use one config folder per account, and record on each session the account it started under.

Swapping credentials can't serve Acorn, which runs several sessions at once. Two sessions on two
accounts need two folders. The proxy carries a ban risk Acorn shouldn't hand its users. The shared
state approach is a later step, covered in [Later steps](#later-steps).

### Where the account goes in

Acorn builds each session's environment from an allowlist. `plugins/agents/src/server/drivers/acpSession.ts`
calls `brokerEnv` for every ACP harness, and `plugins/agents/src/server/drivers/codexDriver.ts` does the
same for Codex. Setting `CLAUDE_CONFIG_DIR` or `CODEX_HOME` per session at those two calls is a small
change. Without it, the only way to move either folder is to set the variable for the whole Node,
which moves it for every session.

Declare the variable on the harness, not in each driver. `HarnessLaunchSpec` in
`plugins/agents/src/server/drivers/harness.ts` could gain a field naming the variable and the default
folder, for example `CLAUDE_CONFIG_DIR` and `~/.claude`. A contributed harness that declares the field
then gets accounts with no extra code, which keeps the plugin boundary intact.

### Pin the account to the session

This is most of the work. Acorn resumes Claude Code sessions from the CLI's own store, which is why
`claudeHarness.ts` declares `sessionPersistence: true`. A session started under account A can only
resume with account A's folder, because the CLI looks for it there. Codex threads behave the same
way.

So the session row in `plugins/agents/src/node/schema.ts` needs an account column, set when the session
is created and never changed. A resume, a terminal handoff, and a delegated child all read it. A
delegated child should inherit its parent's account unless the caller names one.

### Other code that assumes one account

These read one folder and need to read one per account:

- `plugins/agents/src/server/usage/claudeUsage.ts` reads `process.env.CLAUDE_CONFIG_DIR` once, and the
  account email and organization from `.claude.json`.
- `plugins/agents/src/server/usage/codexUsage.ts` probes one Codex login.
- `plugins/agents/src/server/drivers/authProbe.ts` reports one signed-in state per harness.
- `plugins/memory/src/server/memoryImport.ts` imports memory from one Claude config folder.

[Providers and plan usage](../managed-agents/providers.md) says usage is per harness and per account
and that the Node collects it once for every client. That stays true with one reading per account.

### Adding an account

Adding an account runs the CLI's own login with the variable pointed at a fresh folder that Acorn owns,
such as one under the Node's data folder. Run `claude auth login` or `codex login` that way, then read
the result with the same status probe. Acorn never handles the token itself. The CLI writes it to
the Keychain or the folder, as it would for a login run by hand. The user's own `~/.claude` or
`~/.codex` appears as the default account and is never rewritten.

### Running out of quota

`depletedUntil` in `plugins/agents/src/server/usage/service.ts` already finds when every quota on a
harness is spent and when the next one resets, so the runtime can wait. With a second account, Acorn
can offer to start the next session on the account with quota left. It applies to new sessions only.
A running session keeps its account, for the resume reason above. Make this an offer, not an automatic
switch. See [Terms and risks](#terms-and-risks).

## Terms and risks

Two subscriptions held for separate purposes, such as a personal account and an employer's account,
are ordinary use. Rotating accounts to get past rate limits is closer to what the February 2026
terms target. Keep account choice in the user's hands.

Acorn drives Claude Code through the ACP adapter, which uses the Agent SDK to run the user's `claude`
CLI. The February 2026 wording names the Agent SDK. That question applies to Acorn whether or not it
supports more than one account, and this feature doesn't widen it. Recheck the terms before building.

## Later steps

A second account starts with no settings, skills, or MCP servers. If users miss them, link the shared
parts of the default folder into each account's folder, as T3 Code does. Keep a short list of
private files per harness, and refuse to start if a private file turns out to be a link. Wait for the
complaint first, because the list changes with CLI releases.

## Not proposed

- A request proxy. It carries the ban risk above and puts Acorn in the request path.
- Swapping credentials in one folder. It needs Orca's token read-back machinery and still allows
  only one account at a time.
- Copying or storing tokens in Acorn's own credential store. The CLI already owns refresh, and a
  copy goes stale on the first refresh.
- Switching a running session to another account.

## Verify before building

Before implementing, confirm the following:

- Recheck Anthropic's consumer terms and OpenAI's terms on multiple subscriptions and third-party
  launchers.
- Confirm that the installed Claude Code still scopes its Keychain entry by `CLAUDE_CONFIG_DIR`, and
  that the ACP adapter passes the variable through to the CLI it starts.
- Confirm that Codex honours `CODEX_HOME` for login, sessions, and `account/rateLimits/read` when its
  credentials sit in the OS keyring.
- Re-read the owners named above, and the session resume and delegation paths, for any other read of
  `~/.claude` or `~/.codex`.
- Check whether `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY` in the Node's environment would
  override a per-account folder, and strip them for sessions pinned to an account.
- Plan a database migration for the session account column, with existing rows reading as the
  default account.
