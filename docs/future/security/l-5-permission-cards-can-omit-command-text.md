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
