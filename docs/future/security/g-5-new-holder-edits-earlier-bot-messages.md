# G-5: A Node that takes over a thread can edit the bot's earlier messages in it

Found November 20, 2026, in a read-only security review of `jamesmacfie/acorn` at `90b9e61e3` and
`acorn-cloud` at `19fa594`. Severity: low. Confidence: confirmed from code. Status: open.

## What goes wrong

The gateway lets a Node edit or delete a bot message when the message is the bot's and sits in a
thread the Node holds. It doesn't check which Node posted it. Once a thread changes hands, the new
holder can rewrite or delete the previous holder's answers and approval cards.

## Who can do it

Someone with an allowlisted Acorn account and a Node, linked in the same workspace, after a thread's
grant goes away. A grant goes when its Node releases it, when it's idle for 90 days, or when its owner
unlinks or links another Node.

## How it goes

1. The victim's Node held a thread and posted answers and cards in it.
2. The grant goes: released with `DELETE /slack/v1/grants/...`
   (`acorn-cloud:src/slack/gateway.ts:372-383`), lapsed after 90 days
   (`acorn-cloud:src/slack/gateway.ts:122-128`), or deleted on unlink or relink
   (`acorn-cloud:src/slack/gateway.ts:358-361`, `602-603`).
3. The attacker mentions @acorn in that thread, and the gateway gives the thread to the attacker's Node
   (`acorn-cloud:src/slack/gateway.ts:214-225`).
4. The attacker's Node calls `chat.update` or `chat.delete` on one of the victim's bot messages.
   `messageOf` reports it as the bot's, from the cache or from `conversations.replies`
   (`acorn-cloud:src/slack/gateway.ts:148-157`). `allowedCall` checks only that and that the thread is
   held (`acorn-cloud:src/slack/gateway.ts:439-443`).

## What limits it

- Clicks in the thread go to the new holder, so a rewritten card's buttons reach the attacker's Node,
  not the victim's.
- `chat.update` refuses `reply_broadcast` (`acorn-cloud:src/slack/gateway.ts:441`), so an edit stays in
  the thread.

## Fix

In `acorn-cloud`, in `src/slack/gateway.ts`, record the posting Node for each bot message when
`chat.postMessage` succeeds (`gateway.ts:417`), and allow `chat.update` and `chat.delete` only for the
Node that posted it. The in-memory `messages` map drops entries after 100,000 messages and on restart,
so keep the record in a table, or refuse an edit when the poster is unknown. This is the same record
[G-1](./g-1-click-on-another-card-approves.md)'s gateway fix needs.

## How to check the fix

- Gateway test in `acorn-cloud:test/slack.test.ts`: Node A posts in a thread, releases it, Node B takes
  the thread and calls `chat.update` on A's message. Expect `403 not_granted`. B's update of its own
  message still works.

## Related

- [G-1](./g-1-click-on-another-card-approves.md).
- [The Slack gateway API § Calls from a Node](../../account-api/slack-gateway.md#calls-from-a-node).
