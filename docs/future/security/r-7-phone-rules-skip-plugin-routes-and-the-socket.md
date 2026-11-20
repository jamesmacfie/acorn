# R-7: The Slack link page finishes a link for whoever has its code

Found November 20, 2026, in a read-only security review of `jamesmacfie/acorn` at `31ff472da` and
`acorn-cloud` at `19fa594`, as part of a finding about the phone's refusal list. Severity: low.
Confidence: confirmed from code. Status: the Acorn side is fixed, and the `acorn-cloud` side is open.

On the Acorn side, no phone can change the account or Slack settings, and the event socket drops shell
frames from a phone without shell access.
[The November 20 review](../../security/review-2026-11-20.md) records the change. This report covers
the link page that's left.

## What goes wrong

A Slack link starts on the Node, which answers with an address on the account website. That page asks
for the link's code and no account session (`acorn-cloud:src/slack/gateway.ts:481-514`). Whoever sees
the code within its 10 minutes can finish the link with a Slack user of their own, with approvals on.

## What limits it

- A Slack link counts on the Node only after a paired device confirms it, showing the Slack user the
  gateway reports.
- The link shows in **Settings → Slack**, where the owner can unlink it.

## Fix

In `acorn-cloud`, ask for the account session that started the link before the page signs in with
Slack, and refuse the page to any other session.
[G-4](./g-4-sent-link-ties-slack-user-to-wrong-node.md) is the same page sent to someone else, and its
confirmation step fits beside this check.

## How to check the fix

Add a gateway test in `acorn-cloud:test/slack.test.ts` that opens a link address without the starting
account's session and expects no Slack sign-in and no `slack_link` row.
