---
title: Connections
description: Every setting in the Connections group, for the services acorn talks to and the keys it generates text with.
sources:
  - docs/frontend/settings-groups.md
  - docs/integrations/settings.md
  - docs/integrations/project-sources.md
  - docs/integrations/model-providers.md
  - packages/client-core/src/features/settings/corePages.ts
  - packages/client-core/src/features/settings/models/AiModelsSettings.tsx
  - plugins/slack/src/client/SlackSettings.tsx
covers:
  - integrations
  - ai-models
  - slack
checked: '31ff472da'
---

This page lists every setting in **Settings** > **Connections**. Every page is stored on the Node:
a connection you add is used by every device paired with it. A credential is encrypted on the Node and
never shown again ([Credentials and secrets](/docs/security/credentials-and-secrets/)).

## Services

Every connection that isn't a model key: GitHub, Linear, Rollbar, Sentry, and services a
plugin adds. A connection that needs you is listed first, with a dot, and the dot shows beside the page
in the rail.

**Add connection** opens a card per service, saying what each asks for. GitHub signs in with a code.
**Manage** opens one connection's page, which leads with what's wrong, if anything, and the button that
fixes it.

| Setting | What it changes | Stored on | Default |
| --- | --- | --- | --- |
| **Name** | What acorn calls the connection. Blank uses the service's own name for it, such as the Linear workspace. | Node | The service's name for it |
| **Test**, under **Credentials** | Checks the credential with the service. | | |
| **Replace key**, under **Credentials** | Replaces the key, in a form with **Save** and **Cancel**. GitHub has no key: disconnect and connect again instead. | Node | |
| **On** | Turns the connection off without removing it. | Node | On |
| **Where it shows up** | Which of the service's projects each acorn workspace or project follows. Shown for services that have projects. | Node | None |
| **Disconnect** | Removes the connection, after saying what goes with it. | Node | |

A workspace's page and a project's **Connections** tab show the same project map from their side.

## AI models

Keys for generating text, beside the agent CLIs that can do the same
([Model providers and generating text](/docs/agents/model-providers-and-generating-text/)).

| Setting | What it changes | Stored on | Default |
| --- | --- | --- | --- |
| **API keys** | Your OpenAI and Anthropic keys. **Add a key** connects one, and acorn checks it before saving. **Manage** opens it. | Node | No keys |
| **Agent CLIs** | Lists Claude Code and Codex as **Installed** or **Not installed** on the Node's computer. Nothing to set. | | |

Which backend Generate controls use is **Generate with**, under **Agents** > **Harnesses and
defaults**.

## Slack

Links your Slack user to this Node, so a mention of @acorn or a DM to it starts an agent here
([Slack](/docs/built-in-plugins/slack/)). It needs you signed in under **Machines** > **Account**,
with **Remote access** on, and says which is missing.

| Setting | What it changes | Stored on | Default |
| --- | --- | --- | --- |
| **Link Slack** | Gives an address that runs Sign in with Slack, and waits until the link reaches this Node. | Account service | Not linked |
| **Confirm** | Accepts the Slack user the link names. Slack can't start anything here until you do, and a link that later names another user needs confirming again. **Not me, unlink** removes it. | Node | Not confirmed |
| **Link this Node instead** | Moves a link that sends Slack work to another of your Nodes to this one. | Account service | |
| **Unlink** | Removes the link. Mentions and DMs from you stop reaching this Node. | Account service | |
| **Answer approvals from Slack** | Chosen beside **Confirm**. Shows **Approve** and **Deny** in the thread when the agent asks to run something. Off, the card links to acorn instead. Turning it on means a break-in at the hosted service could approve what your agent runs. | Node | Off |

## In the terminal

**Services** and **AI models** open in the desktop app. A connection added there applies to the terminal
client too, because the Node keeps it. **Slack** draws in the terminal client as well, and prints the
sign-in address for you to open.
