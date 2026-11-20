> **Completion note, November 20, 2026.** Fixed on the Acorn side, on branch
> `phase-l-5-permission-cards-show-the-whole-command`.
>
> What landed:
>
> - The `request` event has two optional fields, `command` and `truncated`, stored in the request row's
>   `payload`. `settlePermissionRequest` copies the harness's own command from the permission subject
>   (`rawInput.command` for Claude Code, `params.command` for Codex) onto the request a person answers.
>   A harness bridge ask (`holdAsk` in `loopHooks.ts`) carries its command too.
> - `boundProviderEvent` still bounds the title at 500 characters and the detail and command at
>   16,384. A cut value ends in "…", and the request gets `truncated: true` when the command or detail
>   was cut, or the title was cut and there's no command.
> - Desktop (`AgentRequestCard`): the command shows in a code block as literal text, and Codex's
>   detail is dropped when it repeats the command. A cut request shows a warning and keeps its buttons,
>   because the desktop is where the person can read the tool call in full.
> - Extension: `BridgeAgentRequest` has a `command` field, which the request card and the Needs you
>   row show in a code block. A cut request gets an `unsupported` reason, so the extension shows it
>   without buttons and points to the Acorn app. Older extensions honor that reason too.
> - Slack (`approvals.ts`): the title, command, and detail go in `rich_text` blocks, with no mrkdwn.
>   The notification text escapes `&`, `<`, and `>`. `cardText` decides whether a card shows the
>   whole request: nothing cut to store it, nothing changed by `safeText`, and no command or detail
>   over 2,900 characters. Only a whole card offers **Approve** and **Deny**. Any other card says part of
>   the request is cut or hidden, and links to Acorn. A click on **Approve** runs `cardText` again
>   before it answers, so a card posted before the upgrade can't approve a request it doesn't show in
>   full.
> - Docs: `docs/managed-agents/permission-policy.md` § What the card shows, and
>   `docs/integrations/slack.md` § Approvals.
> - Tests: `boundProviderEvent.test.ts` covers the bounds and the title rule. `permissionPolicy.test.ts`
>   covers a whole and an over-length command on the stored row. `loopHooks.test.ts` covers the bridge
>   ask. `AgentRequestCard.test.tsx` covers literal markup and the cut warning. `Conversation.test.tsx`
>   and `apps/cli/src/browser/agents.test.ts` cover the extension. `slack.test.ts` covers markup in the
>   command and title, the escaped notification text, and three cards without **Approve**: over 2,900
>   characters, a removed secret, and a request cut to store it. Each also refuses a forged
>   **Approve** click.
>
> Decisions and deviations:
>
> - A vetoed request stores no command. Phase 02 kept the subject out of the ledger, and a request
>   nobody answers doesn't need it. The tool event already stores the same input for requests a person
>   does answer.
> - A long title beside a whole command doesn't count as cut. For Claude Code the title is the command
>   with its backticks escaped, so the command block is the literal version.
> - A card that can't show everything drops **Deny** as well as **Approve**, and offers only the link
>   to Acorn. The click handler checks only **Approve** again, because a denial can't run anything.
> - Slack's rendering isn't verified in a live workspace. The tests check the blocks sent. Before
>   relying on it, post a card in a test workspace with a command such as
>   `echo <!here> *x* ``` <https://example.com|docs>` and confirm it shows as typed. The 2,900 limit
>   for a preformatted block follows the section text limit. Slack doesn't document a separate one.
> - When `safeText` finds a known key, its replacement note is mrkdwn italics. In rich text, the
>   underscores show literally.
>
> What acorn-cloud would still need: nothing for this finding. The gateway forwards blocks as the Node
> sends them.
>
> Size: the Node service bundle measures 1,970,133 B, 341 B over the 1,969,792 B the coordinator gave.
> The desktop renderer budget passes. The card is in the `AgentEventCard` chunk.
>
> For later phases: a card that shows a request to a person should read `payload.command` and
> `payload.truncated`, and offer an approval only when it can show the whole request. G-5 or any later
> Slack change that posts provider text should use the same `rich_text` approach as `cardText`.

# L-5. Permission cards can omit part of the command they approve

Found November 20, 2026, in Acorn at `90b9e61e3`. Severity is medium for Slack and low for
desktop and extension views. Command truncation is confirmed from source. Slack's live
rendering of unescaped text remains unverified. Status is open.

## Evidence and impact

Acorn bounds provider permission request titles and details in
`plugins/agents/src/server/sessions/boundProviderEvent.ts`. The Claude ACP adapter can put
the command in the title, and Codex puts it in the detail. The bounds can drop text without
marking the displayed request as incomplete.

The Slack card uses the bounded text, cuts the detail again, and sends formatted text.
The extension and desktop request cards also use the bounded request. On desktop, the
surrounding transcript can contain the fuller tool input. The request card's approval still
authorizes the harness's original command.

- `plugins/agents/src/server/drivers/acpNormalizer.ts` and
  `plugins/agents/src/server/drivers/codexNormalizer.ts` map provider requests to the card fields.
- `plugins/slack/src/server/approvals.ts` formats and truncates Slack approval cards.
- `plugins/agents/src/client/sessions/AgentRequestCard.tsx` and
  `apps/extension/src/sidebar/Requests.tsx` render the request alongside an approval control.

The risk requires a command that untrusted input can influence and a person who approves it.
Slack also requires the remote approval setting. This finding concerns what the owner sees on
the correct card. [G-1](./g-1-click-on-another-card-approves.md) covers which card can answer.

## Fix and verification

Keep a structured description of the operation the harness will perform. Render commands as
literal text, label truncated or redacted previews, and require review in a trusted Acorn
client when a card cannot faithfully show the operation.

Test bounded, over-length, redacted, and markup-containing command descriptions. Verify that
the card's approval controls match the amount and type of information it can show. Test the
Slack rendering with inert text in a test workspace before relying on it.
