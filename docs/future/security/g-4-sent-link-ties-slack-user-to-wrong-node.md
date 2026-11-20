# G-4: A link page someone sends you ties your Slack user to their Node

Found November 20, 2026, in a read-only security review of `jamesmacfie/acorn` at `90b9e61e3` and
`acorn-cloud` at `19fa594`. Severity: low. Confidence: confirmed from code. Status: open.

## What goes wrong

A Slack link page works in whichever browser opens it first. If someone sends you the link page for
their own Node and you sign in with Slack, your Slack user is linked to their Node. Your mentions and
direct messages to @acorn then go to their agent, and your own account can't link that Slack user
until they unlink it. The page warns about this, and nothing runs on your machine.

## Who can do it

Anyone with an allowlisted Acorn account and a registered Node, who can get the victim to open a URL
within 10 minutes and click **Sign in with Slack**.

## How it goes

1. The attacker's Node calls `POST /slack/v1/links` for the attacker's own Node and gets
   `/slack/link/<code>` (`acorn-cloud:src/slack/gateway.ts:322-334`).
2. The attacker sends that address to the victim. Opening it sets the link cookie in the victim's
   browser (`acorn-cloud:src/slack/gateway.ts:499-505`) and shows the link page.
3. The victim clicks **Sign in with Slack**. The callback finds the cookie, matching the state
   (`acorn-cloud:src/slack/gateway.ts:519`), and links the victim's Slack user to the attacker's account
   and Node (`acorn-cloud:src/slack/gateway.ts:590-622`).
4. The victim's @acorn messages now go to the attacker's Node with `routedBy: 'sender'`
   (`acorn-cloud:src/slack/gateway.ts:216-226`). When the victim tries to link from their own account,
   the gateway answers "Already linked" (`acorn-cloud:src/slack/gateway.ts:597`, `613-617`).

The cookie only makes the victim pass through the link page. It doesn't stop the page from being
opened by someone else.

## What limits it

- The link page names the attacker's account email and Node label, and says to continue only if you
  started it from **Settings → Slack** yourself (`acorn-cloud:src/slack/pages.ts:16-31`).
- The code lasts 10 minutes and works once (`acorn-cloud:src/slack/gateway.ts:36`, `618`).
- The contract names this risk ([Links](../../account-api/slack-gateway.md#links)).

## Fix

The cheapest useful change, in `acorn-cloud`, is a confirmation step after Slack sign-in. In
`src/slack/gateway.ts`, instead of linking straight from the callback, show a page that names both
sides, "Link <Slack user> in <workspace> to <Node> of <account email>?", with a form button that posts
back to finish. Give the form its own token tied to the link cookie. This doesn't stop a determined
victim from confirming, so treat it as a smaller window, not a closed one.

Accepting the risk as documented is also reasonable at this severity.

## How to check the fix

- Gateway test in `acorn-cloud:test/slack.test.ts`: after the OAuth callback, expect the confirmation
  page and no `slack_link` row. After the form post, expect the row.
- Gateway test: a form post without the cookie, or with another code's cookie, links nothing.

## Related

- [G-3](./g-3-dev-tunnel-exposes-test-mode.md), where the test shortcut skips this page's Slack sign-in.
- [The Slack gateway API § Links](../../account-api/slack-gateway.md#links).
- [Linking in the Slack integration](../../integrations/slack.md#linking).
