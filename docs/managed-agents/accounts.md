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
- **The default account.** Once a harness has an account, a session that names none starts on its
  default account: the one the person chose, or else the first by name. That covers workflow steps,
  custom agents, inline diff chats, and a delegated child on another harness. The CLI's own login
  then starts no new session. The choice is a `.default` file beside the account folders
  (`AgentAccounts.defaultAccount`), so it applies across the Node and goes away with its folder. A
  session that resumes a provider reference skips it, because the CLI finds the reference only in the
  folder it came from. That is how a session started before the first account keeps resuming.
- **Every start.** The lifecycle reads the account at every start and resume, because the CLI finds a
  session only in the folder it started in. `withAccountHome` sets the variable after the env
  allowlist and removes the overriding variables. A session whose account was removed fails to start
  and says so.
- **Shared skills.** Before every start and terminal handoff, Acorn links each of the person's own
  skills from the default login into the account's folder (`linkSharedSkills` in `accounts.ts`). For
  Claude Code that's every entry in `~/.claude/skills`, except `synced`, which holds the skills
  claude.ai syncs for each login separately. It removes a link whose skill is gone and leaves anything
  else in the folder alone. A skill added later shows up from the next start. If the links fail, the
  session still starts without them.
- **Other readers.** The terminal handoff passes the same variable. A delegated child on its parent's
  harness inherits the parent's account.

## Add an account

In Settings, open **Agents** > **Harnesses and defaults** > **Accounts**, type a name, and click
**Add**. Acorn makes the folder and shows the sign-in command, such as
`CLAUDE_CONFIG_DIR='…/agent-accounts/claude/work' claude auth login`. Run it on the computer the Node
runs on, then click **Check again**. The CLI writes the token itself, so Acorn never handles it.

Once a harness has an account, the section shows a **Default account** dropdown that lists its
accounts. `PUT /v1/p/agents/providers/:providerId/default-account` saves it,
and the provider descriptor reports it as `defaultAccount`.

`POST /v1/p/agents/providers/:providerId/accounts` and `DELETE …/accounts/:name` back the page. Both
are device-only and answer the fresh provider list. A provider descriptor lists its accounts under
`accounts`, each with its sign-in state from the CLI's own status command. **Remove** runs the CLI's
logout against the folder before deleting it. Otherwise a later account given the same name would find
the old Keychain login.

Each account shows as its own row in **New**, on the empty pane's cards, and in the palette, labeled
`Claude Code · work`. Once a harness has an account, its plain row goes away, so the default login
can't start a new session from **New**. Add your usual login as an account too if you want to keep
picking it. The default account is listed first. A signed-out account's row is disabled.

## Plan usage

A collector registered with `accounts: true` is asked once for each account, with that account's
folder, and not for the CLI's own login, which starts no new session once accounts exist
(`createAgentUsageService` in `server/usage/service.ts`). A harness without accounts is read as
before. Each reading is its own row, labeled with the account name and carrying `accountName`. The
plan usage panel groups a harness's readings and draws a tab per account, so the numbers below are
one account's at a time (`usageGroups` in `client/usage/usageModel.ts`). The button that opens the
panel shows one figure per harness, the default account's.

`claude auth login` signs a folder in without running Claude Code's first-run setup, so the CLI
opens an account folder on its theme picker and the probe never reaches `/usage`. Before it reads an
account folder, the probe sets `hasCompletedOnboarding` in that folder's `.claude.json`
(`markClaudeOnboarded`). It never edits the person's own config. When a session hits
a usage limit, the wait reads the quota of the session's own account. For more information, see
[Providers and plan usage](./providers.md#plan-usage).

## Limits

- A new account starts with no settings, MCP servers, or history from the default folder. Only the
  person's skills are linked in. Linking the rest, as T3 Code does, needs a list of private files per
  CLI release. Wait until someone misses them. Acorn's own server isn't one of them either. A session on an account gets it
  when it starts, and again in a terminal handoff ([MCP](../mcp.md#configuration)).
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
