# G-6: One Node can use up a workspace's whole Slack rate limit

Found November 20, 2026, in a read-only security review of `jamesmacfie/acorn` at `90b9e61e3` and
`acorn-cloud` at `19fa594`. Severity: low. Confidence: confirmed from code. Status: open.

## What goes wrong

The contract says the gateway keeps each Node to a share of its workspace's Slack rate limit. The
gateway doesn't. Every Node in a workspace shares one bot token, so one busy or hostile Node can spend
the limit and make every other Node's Slack calls fail with `429 rate_limited`.

## Who can do it

Someone with an allowlisted Acorn account and a Node, linked in the workspace. A Node with a bug that
loops on Slack calls does the same by accident.

## How it goes

1. The contract promises a per-Node share
   ([Calls from a Node](../../account-api/slack-gateway.md#calls-from-a-node), at
   `docs/account-api/slack-gateway.md:137-138`).
2. `POST /slack/v1/calls` makes the call with the workspace's bot token and no per-Node count. The code
   names it as a shortcut (`acorn-cloud:src/slack/gateway.ts:411-413`).
3. The attacker's Node sends calls it's allowed to make, such as `users.info`, which needs no thread
   (`acorn-cloud:src/slack/gateway.ts:454-455`), as fast as Slack accepts them.
4. Slack answers `429` for the workspace's token, and the gateway passes it on to every Node
   (`acorn-cloud:src/slack/gateway.ts:415`). Other owners' answers and approval cards don't post until
   Slack's window resets.

## Fix

In `acorn-cloud`, in `src/slack/gateway.ts`, count calls per Node and method in memory, with a budget
a little under Slack's tier for that method divided by the number of Nodes linked in the workspace.
Answer `429 rate_limited` with `retryAfter` once a Node is over its share, before calling Slack. Until
that lands, change `docs/account-api/slack-gateway.md:137-138` to say the share isn't enforced.

## How to check the fix

- Gateway test in `acorn-cloud:test/slack.test.ts`: two Nodes linked in one workspace. Node A sends
  `users.info` past its share and gets `429 rate_limited` from the gateway without a call reaching the
  fake Slack. Node B's next call still succeeds.

## Related

- [The Slack gateway API § Calls from a Node](../../account-api/slack-gateway.md#calls-from-a-node).
