---
title: Credentials and secrets
description: Where acorn keeps your keys and tokens, what an agent or a plugin can reach, and the checks for secrets before a commit or push.
sources:
  - docs/security/credentials.md
  - docs/security/secret-publication.md
  - docs/security/plugin-secrets-and-routes.md
  - docs/security.md
checked: '9aaaaf7d3'
---

This page covers where acorn stores credentials such as your GitHub token and API keys, why agents
don't get them, how a plugin uses one without reading it, and the check for secrets before a commit, a
push, an export, or an agent message. Read it before you connect a service or run agents unattended.

## Where credentials are stored

A credential you add, such as a GitHub sign-in, an API key, or a Linear token, is stored on the Node:

- **Encrypted at rest** with the Node's session key, in its database.
- **Write-only.** You enter it once. No API answer, log, event, error, or device ever gets it back.
- **Used on the Node.** When the GitHub plugin or a model provider needs it, the Node decrypts it for
  that one call. If the call fails and the provider's error quotes the credential, acorn removes it from
  the error before it goes anywhere.

### Where the keys are

A Node has two keys: the session key, which encrypts stored credentials, and a signing key for agent
tokens. Where they live depends on how the Node runs:

| Node | Where the keys are |
| --- | --- |
| Started by the packaged desktop app | Sealed in a file in the data folder, under a key in the system keychain. Neither key is on disk or in the Node's environment in plain form. |
| Started by a development build, or where the keychain refused | The same sealed file, but the key that opens it is a plain file. |
| A standalone Node | Plain files in its data folder, or from its environment. It warns about this at boot. |

**Check this node** under **Settings** > **Machines** > **Security and backup** says which applies
([Security diagnostics](/docs/security/security-diagnostics/)).

## Why agents don't get credentials

An agent reaches acorn through a token for one task, and that token can't spend a stored credential:

- **Its environment** is built from an allowed list. It doesn't inherit acorn's keys, your GitHub
  token, or arbitrary variables from the Node.
- **Its token** gets an empty credential from any route that would use one. Routes that manage or
  spend a connection refuse it outright.
- **acorn's tools** use credentials on the Node and return only the result. Opening a pull request
  with `github_pull_create` doesn't hand the agent your token.
- **A Generate call through an agent CLI** gets no acorn token, no MCP server, and no API key acorn
  holds. The CLI uses its own login.

An agent runs as your own user, so file permissions don't stop it reading files in the data folder.
What it can read there, and the setting that closes it for Claude Code, is on
[What acorn doesn't protect against](/docs/security/what-acorn-doesnt-protect-against/#agents-read-what-you-can-read).

## How a plugin uses a credential

A plugin never gets a "read the secret" call. It asks the Node to run something with the credential:

- A plugin's provider gets the credential lent for the length of one call, for one connection it owns.
- A plugin's tool, such as GitHub's, borrows the first usable connection for one callback.
- A model call goes through the Node, which holds the key and makes the call.

A plugin's manifest says whether it uses stored secrets at all, and its trust prompt shows that
([Plugin trust and permissions](/docs/security/plugin-trust-and-permissions/)).

## Check for secrets before publishing

acorn checks for credential-shaped text before four things it does for you:

- A commit from the **Changes** tab.
- A push from the **Changes** tab.
- An agent transcript export.
- An agent message that carries attachments.

The detector runs on the Node with no network call. It has two tiers:

| Tier | What it finds |
| --- | --- |
| High confidence | Private key headers, AWS access key IDs, and GitHub, GitLab, Slack, Stripe live, Anthropic, OpenAI, Google API, and npm tokens, and Slack webhooks |
| Heuristic | JWTs, passwords in URLs, and `key = "value"` assignments that look random |

It skips common placeholders, such as AWS's `EXAMPLE` keys and `${…}` slots. A report names the rule,
the file, and the line, never the matched text.

**Check for secrets** in the **Changes** tab runs the check and reports. It never stops anything.

### Block publication

**Block publication with secret findings**, under **Settings** > **Machines** > **Security and backup**,
is off by default, and stored on the Node. With it on:

- A high-confidence finding stops the commit, push, export, or send.
- A check that couldn't finish stops it too: a file too large to scan, a timeout, or a Git failure.
- Heuristic findings warn and let it through.

To go ahead anyway, allow the operation once on that page. The allowance covers that exact content and
destination for ten minutes. Changed content asks again. The audit log records each refusal and each
allowance.

A push check reads everything the push would send that the remote doesn't have, including a secret a
later commit deleted. An attachment that isn't text, such as a picture or a PDF, can't be scanned, so
with blocking on, a turn that carries one needs an allowance.

**Export Markdown without secrets** and **Export JSON without secrets**, in a session's menu, return a
copy with each match replaced by `[redacted secret]`. The stored session doesn't change.

## In the terminal

The terminal client stores its device token in a folder only your user can open, with files only your
user can read. An agent runs as your user, so it can read that token too, unless **Keep agents out of
Acorn's data folder** is on. Credentials themselves stay on the Node, as they do for the desktop app.

## Limits

- The checks cover only acorn's own commit, push, export, and send. A `git push` in a terminal, or by
  an agent's own tools, isn't checked.
- The text of a message isn't checked, only its attachments.
- A finding revokes nothing. If a credential may have left your machine, rotate it with its provider.
- A plugin that stores a secret in its own tables, instead of through acorn, keeps it outside these
  rules.
