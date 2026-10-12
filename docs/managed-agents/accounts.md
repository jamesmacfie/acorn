# Harness accounts

This page covers how a Node runs more than one Claude Code or Codex subscription side by side, such
as a work account beside a personal one. Read it before you change how a session finds its login.

## How it works

Neither CLI has profiles. Each keeps one login per config folder, and each reads a variable that
moves the whole folder: `CLAUDE_CONFIG_DIR` for Claude Code and `CODEX_HOME` for Codex. Claude Code
2.1 and later also name their macOS Keychain entry after the folder, so two folders hold two logins
there too. Acorn gives each extra account its own folder and points the CLI at it.

- **Accounts.** `AgentAccounts` in `plugins/agents/src/server/accounts.ts` keeps one owner-only folder
  per account under `<data root>/agent-accounts/<harness>/<name>`. The folders are the record. An
  account exists when its folder does, and the name is lowercase letters, digits, and dashes. The
  harness's default login stays wherever its CLI keeps it, and Acorn never rewrites it.
- **The harness field.** A harness declares `accounts` (`HarnessAccounts` in
  `plugins/agents/src/server/drivers/types.ts`): the variable, the CLI's login and logout arguments,
  and any Node variables that would override the folder's login. Claude Code lists
  `CLAUDE_CODE_OAUTH_TOKEN`, which its passthrough would otherwise carry. Codex declares the same
  shape in `drivers/accountEnv.ts`. Only built-in harnesses can declare it.
- **The session.** `POST /sessions` takes `account`. `reserveSession` checks the harness holds it and
  that it's signed in, then writes it to the session's `config.account`, a key only the Node writes.
  An `account` a client put in `config` is dropped. A fork copies its source's config, so it stays on
  the same account.
- **Every start.** The lifecycle reads the account at every start and resume, because the CLI finds a
  session only in the folder it started in. `withAccountHome` sets the variable after the env
  allowlist and removes the overriding variables. A session whose account was removed fails to start
  and says so.
- **Other readers.** The terminal handoff passes the same variable. A delegated child on its parent's
  harness inherits the parent's account. A child on another harness uses that harness's default.

## Add an account

In Settings, open **Agents** > **Harnesses and defaults** > **Accounts**, type a name, and click
**Add**. Acorn makes the folder and shows the sign-in command, such as
`CLAUDE_CONFIG_DIR='…/agent-accounts/claude/work' claude auth login`. Run it on the computer the Node
runs on, then click **Check again**. The CLI writes the token itself, so Acorn never handles it.

`POST /v1/p/agents/providers/:providerId/accounts` and `DELETE …/accounts/:name` back the page. Both
are device-only and answer the fresh provider list. A provider descriptor lists its accounts under
`accounts`, each with its sign-in state from the CLI's own status command. **Remove** runs the CLI's
logout against the folder before deleting it. Otherwise a later account given the same name would find
the old Keychain login.

Each account shows as its own row in **New**, on the empty pane's cards, and in the palette, labeled
`Claude Code · work`. Once a harness has an account, its plain row goes away, so the default login
can't start a new session from **New**. Add your usual login as an account too if you want to keep
picking it. A signed-out account's row is disabled. Custom agents start on the default login.

## Plan usage

A collector registered with `accounts: true` is asked once for the default login and once for each
account, with that account's folder (`createAgentUsageService` in `server/usage/service.ts`). Each
reading is its own row, labeled with the account name and carrying `accountName`. The plan usage
panel groups a harness's readings and draws a tab per login, **Default** first, so the numbers below
are one account's at a time (`usageGroups` in `client/usage/usageModel.ts`). When a session hits
a usage limit, the wait reads the quota of the session's own account. For more information, see
[Providers and plan usage](./providers.md#plan-usage).

## Limits

- A new account starts with no settings, skills, MCP servers, or history from the default folder.
  Linking the shared parts in, as T3 Code does, needs a list of private files per CLI release. Wait
  until someone misses them.
- A contributed harness can't declare `accounts`. The field would let a plugin choose a variable that
  Acorn sets to a path in its data root, so it needs its own review before it joins the manifest.
- Acorn doesn't offer to start a session on another account when one runs out of quota.
- Memory import reads only the default Claude Code folder.
- With [the read block](./read-block.md) on, Claude Code's file tools can't write auto-memory into an
  account folder, because the folder is inside the data root.

## Why

One folder per account is the only approach that lets two sessions on two accounts run at once.
Swapping credentials in one folder allows one account at a time and needs the refreshed token read
back before every switch, because both CLIs rotate their refresh token. A proxy that puts a different
account's token on each request is what Anthropic's February 2026 terms target. Choosing an account
stays with the person, and Acorn never switches a running session.
