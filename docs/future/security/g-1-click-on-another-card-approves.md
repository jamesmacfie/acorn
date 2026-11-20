> **Completion note, November 20, 2026.** Fixed on the Acorn side, on branch
> `phase-g-1-approvals-check-the-original-card`.
>
> What landed:
>
> - A `slack_cards` table, added by migration `0002_approval_cards`. It holds one row for each permission
>   request's card: the request, session, thread, install, link ID, channel, and message timestamp, plus
>   an `answered` flag. The row goes in once `chat.postMessage` returns the message's timestamp. A repeated
>   `request-changed` event for a request that already has a card posts no second card.
> - A click looks up the card by its install, channel, and `container.message_ts`. The button's value must
>   name that card's session and request. The link comes from the card's own team and link ID through
>   `store.linkOf`, so the approvals choice is the one on the request's own link. The card's thread must
>   still hold the session under the same link ID. A missing or mismatched card answers nothing and posts
>   nothing.
> - `claimCard` sets `answered` with a conditional update, so each card takes one answer. A failed answer
>   releases it. The in-memory `cards` map and `answered` set are gone. A restart keeps cards, so a click
>   on an older card goes through the same checks, and an answer given in Acorn still updates the card.
> - `purgeTasks` deletes a purged thread's cards. `docs/integrations/slack.md` § Approvals describes the
>   binding.
> - `plugins/slack/src/server/slack.test.ts` covers a valid card, a click from another message, another
>   channel, a value naming another request, a click with no message, another install whose link has
>   approvals on, a duplicate answer across a restart, a mismatch after a restart, Acorn's answer after a
>   restart, and a repeated request event. Three of the cases fail on the old handler. The other-install
>   case already failed closed through X-1's link check, and stays as a guard on where the approvals
>   choice comes from.
>
> Decisions and deviations:
>
> - The card's identity is its message, not the button value. The value stays as a cross-check, so a
>   button carrying a changed value answers nothing.
> - Cards that only link to Acorn get a row too, so an answer in Acorn can update them. Their button has
>   no action the click handler answers.
> - The migration only adds a table. Cards posted before the upgrade have no row, so their buttons answer
>   nothing, and the owner answers those in Acorn.
> - The click doesn't compare the payload's `thread_ts`. A message timestamp is unique within its
>   channel, and the stored row fixes the thread.
>
> What acorn-cloud would still need:
>
> - The gateway should record the Node that posted each actionable bot message and route that message's
>   clicks to that Node, whatever the thread grant says at click time. It should also test that a grant
>   change doesn't move a card's clicks to another Node. G-5 needs the same message ownership data for
>   edits. The Node side here refuses a click on a card it didn't post, so a misrouted click answers
>   nothing on the wrong Node.
>
> For later phases: `store.cardAt` and `slack_cards` record which bot messages this Node posted as cards.
> G-5 could extend the same idea to every bot message the Node posts.

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
