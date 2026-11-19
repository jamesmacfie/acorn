# The Slack app

The Slack gateway ([the Slack gateway API](./slack-gateway.md)) runs as one Slack app, shared by every
workspace that installs Acorn. Read this page to make the app for a service that answers the gateway
API, or to change the scopes and events it asks for.

## The manifest

Replace `ACCOUNT_SERVICE` with the service's address. Slack accepted this manifest on November 19, 2026,
`user` scopes included:

```json
{
  "display_information": {
    "name": "Acorn",
    "description": "Talk to your Acorn agents from Slack."
  },
  "features": {
    "app_home": {
      "messages_tab_enabled": true,
      "messages_tab_read_only_enabled": false
    },
    "bot_user": { "display_name": "acorn", "always_online": true },
    "slash_commands": [
      {
        "command": "/acorn",
        "url": "https://ACCOUNT_SERVICE/slack/v1/commands",
        "description": "Set your project or mode for this channel, or get help.",
        "usage_hint": "project <name> | mode tasks|conversation | help",
        "should_escape": false
      }
    ]
  },
  "oauth_config": {
    "redirect_urls": ["https://ACCOUNT_SERVICE/slack/v1/oauth/callback"],
    "scopes": {
      "bot": [
        "app_mentions:read",
        "channels:history",
        "groups:history",
        "im:history",
        "mpim:history",
        "chat:write",
        "chat:write.customize",
        "reactions:write",
        "commands",
        "users:read"
      ],
      "user": ["openid", "profile"]
    }
  },
  "settings": {
    "event_subscriptions": {
      "request_url": "https://ACCOUNT_SERVICE/slack/v1/events",
      "bot_events": [
        "app_mention",
        "message.channels",
        "message.groups",
        "message.im",
        "message.mpim",
        "app_uninstalled",
        "tokens_revoked"
      ]
    },
    "interactivity": {
      "is_enabled": true,
      "request_url": "https://ACCOUNT_SERVICE/slack/v1/interactions"
    },
    "org_deploy_enabled": false,
    "socket_mode_enabled": false,
    "token_rotation_enabled": false
  }
}
```

`messages_tab_enabled` matters. Without the **Messages** tab, nobody can DM the bot, and DMs are where
conversation mode starts. The `openid` and `profile` user scopes let Sign in with Slack share the bot's
app, so linking needs no second client.

`message.channels` sends every message in every public channel the bot is in, not only the ones meant
for it. The gateway forwards a message only when a [routing rule](./slack-gateway.md#routing) matches,
and keeps nothing from the rest.

## Set up the app

Set up the app in this order:

1. Create it in a workspace that lasts, not a test sandbox. An app stays with the workspace it was
   made in.
2. Leave out `event_subscriptions` at first. Slack checks the events address when it's saved, so add
   the block once the gateway answers that check. Slack saves the slash command and interactivity
   addresses with nothing answering them.
3. Turn on public distribution before installing the app in any other workspace.

The service keeps the client ID, the client secret, the signing secret, and a key that encrypts the bot
tokens it stores. Creating the app also shows a bot token, a user token, and an app-level token for its
home workspace. The service needs none of them: it gets each workspace's bot token through
**Add to Slack**, and the app-level token is for Socket Mode.

## Slack facts the gateway relies on

These come from Slack's documentation as recorded on November 19, 2026, and weren't all re-read. A test
app confirmed the manifest, the **Messages** tab, and the sandbox steps below. Check a fact against
[Slack's API documentation](https://api.slack.com/) before you change code that relies on it:

- The Events API posts to one request address per app, for every workspace that installed it. An
  answer later than three seconds makes Slack retry up to three times, with `X-Slack-Retry-Num`.
- Socket Mode allows 10 connections per app, and sends each event to one of them, so Nodes can't
  share one app over it.
- Since May 29, 2025, an app distributed outside the Slack Marketplace may call
  `conversations.history` and `conversations.replies` once a minute, for at most 15 messages. The Node
  keeps its own record of a thread, and reads Slack's once, when the bot is mentioned partway through.
- `chat.postMessage` allows about one message a second per channel. `chat.update`, `reactions.add`,
  and `reactions.remove` allow about 50 a minute for the app in one workspace. Status edits are the
  first thing a Node drops.
- The `markdown` block takes standard Markdown, up to 12,000 characters a message.
- A button click posts a signed payload with the clicker's user ID, and its `response_url` replaces
  the message for 30 minutes. Ephemeral messages can carry buttons and a `static_select` of up to 100
  options.

## Make a test workspace

A Slack developer sandbox is free, an Enterprise Grid org, and has nobody else in it:

1. Join the Slack Developer Program with the same email as your Slack account. Without it,
   `slack sandbox list` answers `developer_not_found`.
2. Sign the Slack CLI in to any workspace you belong to. `slack login --no-prompt` prints a
   `/slackauthticket` line. Send it in that workspace, approve, and pass the challenge code to
   `slack login --ticket <ticket> --challenge <code>`.
3. Run `slack sandbox create --team <team ID> --name <name>`. Leave out `--password`, so sign-in is
   by an emailed link.
4. Open the `.enterprise.slack.com` address the command prints. The `.slack.com` address that
   `slack sandbox list` prints shows Slack's error page.

A basic sandbox is archived after a month without use. Adding a payment method keeps it, and charges
nothing.
