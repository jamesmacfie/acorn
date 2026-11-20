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
