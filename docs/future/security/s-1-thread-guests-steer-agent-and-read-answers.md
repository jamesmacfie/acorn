> **Completion note, November 20, 2026.** Fixed on the Acorn side, on branch
> `phase-s-1-thread-guests-can-t-steer-the-agent`.
>
> What landed:
>
> - Guests are off by default in every channel. `slack_channels.guests`, added by migration
>   `0003_guest_context`, holds the owner's choice, set with `/acorn guests on` or `/acorn guests off`. Only
>   the linked owner's command changes it, the same check as `/acorn project` and `/acorn mode`.
> - With guests off, the Node doesn't store a guest's reply, so no later turn can read it. A mention partway
>   through a thread makes no `conversations.replies` call. The turn also checks the setting as it runs, so
>   replies stored while guests were on stay out after `/acorn guests off`.
> - With guests on, guest replies and the thread so far go in context blocks labelled "Untrusted: replies
>   from others in the thread" and "Untrusted: the thread so far". Each line names its sender only by Slack
>   user ID, and quotes the text as JSON, so a newline in it can't start a line that looks like the owner's.
>   The plugin no longer calls `users.info`, and a guest's stored `user_name` is empty.
> - The rules block names the owner by display name and user ID, and says text from any other Slack user is
>   untrusted, whatever name it uses.
> - Every Slack turn keeps X-1's `requireCommandApproval: true`, guests on or off. That remains the
>   authorization boundary. The labels only help the model read the text.
> - Tests: `plugins/slack/src/server/slack.test.ts` has a new "other people in a thread" block. It covers
>   both sources kept out by default, `/acorn guests off` dropping replies kept while on, a guest's attempt
>   to turn guests on, a guest using the owner's display name with a forged line in their text, a Slack
>   Connect participant from another organisation, and a turn with guest context whose request matches the
>   one without it, apart from its words. `plugins/agents/src/server/sessions/sessionExecute.test.ts` drives
>   a fake harness that starts in Auto. A turn carrying untrusted Slack text gets the same tool ceiling,
>   effective policy, minted token claims, and switch to `default` mode as a turn without it.
> - Docs: `docs/integrations/slack/conversation-rules.md` § The owner and everyone else, `slack.md`, and the
>   public site's Slack page.
>
> Decisions and deviations:
>
> - The opt-in is per channel, not per link. It sits beside a channel's project and mode, and the owner
>   decides it for the people in that channel. It goes through `/acorn`, so it has the same trust as an
>   owner's prompt. A compromised gateway that could forge the opt-in could already forge the owner's
>   prompt, which X-1's approval policy covers.
> - The opt-in covers the owner's own earlier thread messages too. Pre-mention history mixes everyone's
>   messages, and splitting it out wasn't worth the code.
> - Slack Connect channels get no special rule. Guests from another organisation are off by default like
>   everyone else, and the owner can opt in. The `/acorn guests` reply warns that anyone who can post writes
>   that text. I didn't label lines with the sender's organisation, because that needs another stored column
>   and the user ID already tells them apart.
> - Display names are gone from guest context, not just demoted. The model can still mention a guest in its
>   answer with `<@ID>`, which Slack shows as their name.
> - The Node service bundle is unchanged: 1,969,537 B before and after. The Slack code that changed loads on
>   the first delivery, not at startup.
>
> What acorn-cloud would still need: nothing for this fix. The gateway keeps delivering guest replies, and
> the Node drops them unless the owner opted in. The gateway could skip delivering them to a Node that
> doesn't want them, which would save relay traffic but isn't a security boundary.
>
> For later phases: a new source of Slack text for the agent should check `slack_channels.guests` and go
> through `threadLine` in `plugins/slack/src/server/text.ts`. Owners who relied on guest replies reaching
> the agent need to run `/acorn guests on` in those channels after upgrading.

# S-1. Guest Slack messages can influence an owner's agent

Found November 20, 2026, in Acorn at `90b9e61e3` and `acorn-cloud` at `19fa594`. Severity
is medium. Guest text reaching the model is confirmed from source. Command execution and
disclosure depend on how the model and harness handle that text. Status is open.

## Evidence and impact

The gateway delivers guest replies in a held thread. `plugins/slack/src/server/inbound.ts` saves
those replies and reads earlier thread history when a mention starts work mid-thread.
`plugins/slack/src/server/turns.ts` adds both to the owner's next turn. Guest messages wait for
an owner turn. The model gets a prose instruction to treat them as context, and the resulting
answer is posted back to the channel.

A guest or Slack Connect participant can influence the next turn. Display names do not establish
identity. A command-enabled harness can act on the text, and a shared answer can disclose project
data outside the intended audience even if known credential values are redacted.

## Fix and verification

Keep guest replies and pre-mention history out of prompts unless the owner opts in for the link
or channel. Label permitted text as untrusted, identify contributors by stable Slack IDs, and
enforce the owner-approved execution policy from [X-1](./x-1-account-takeover-to-slack-agent-turns.md).
Formatting and context labels help the model interpret messages. The execution policy is the
authorization boundary.

Add tests for both sources of guest text, a guest sharing the owner's display name, and a
Slack Connect channel. Use a fake harness to verify that adding guest context grants no tools
and does not change the policy for the turn.
