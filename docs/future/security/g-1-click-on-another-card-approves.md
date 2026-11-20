# G-1. Slack approvals lack a check for the original card

Found November 20, 2026, in Acorn at `90b9e61e3` and `acorn-cloud` at `19fa594`. Severity
is high with the prerequisites below. The missing checks are confirmed from source. Status is open.

## Evidence and impact

`plugins/slack/src/server/approvals.ts` saves a posted card's channel and timestamp, but the click
handler uses the session and request references in the button value without matching them to the
saved card. It also reads the approval preference for the clicked installation before verifying
that the request belongs to that installation and thread.

The hosted gateway routes clicks using thread grants and the clicker's link. Bot messages do not
carry durable ownership for routing. A different card can therefore be associated with a pending
request. An unintended approval requires a live permission request, access to its references, a
linked owner who can approve in Slack, and a click by that owner. The request still has to belong
to a Slack-started session. The potential impact is approval of a command the owner did not see
on the clicked card.

## Fix and verification

Bind each approval to a durable, single-use record for the link, installation, channel, thread,
message, and request. Reject a mismatched or missing record, including after restart. Check the
approval preference for the request's own link. The gateway should also retain the originating
Node for each actionable message and use it for routing. [G-5](./g-5-new-holder-edits-earlier-bot-messages.md)
covers the same message ownership data for edits.

Add tests for a valid card, mismatched message and installation, a duplicate answer, and restart.
Test that a thread grant change does not move an actionable message to another Node.
