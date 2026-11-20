# G-1. The Slack gateway routes a card's clicks by the thread, not the card

Found November 20, 2026, in Acorn at `90b9e61e3` and `acorn-cloud` at `19fa594`. Severity: high,
conditional. Status: the Acorn side is fixed, and the `acorn-cloud` side is open. The Node checks each
click against the card it posted, as [the November 20 review](../../security/review-2026-11-20.md)
records. This report covers only the gateway work left.

## Evidence and impact

The hosted gateway routes a click on a bot message using the thread's grant and the clicker's link. It
keeps no record of which Node posted a message. When a thread's grant moves to another Node, clicks on
cards the first Node posted go to the second.

On the Node, the `slack_cards` table binds each card to its message, request, thread, and link. A
click on a card the Node didn't post answers nothing. So a misrouted click can't approve a command on
the wrong Node. It still reaches a Node that shouldn't see it, and the Node that posted the card never
hears the answer.

## Fix and verification

In `acorn-cloud`, record the Node that posted each actionable bot message. Route that message's clicks
to that Node, whatever the thread grant says at click time.
[G-5](./g-5-new-holder-edits-earlier-bot-messages.md) needs the same message ownership data for edits.

Test that a thread grant change doesn't move a card's clicks to another Node.
