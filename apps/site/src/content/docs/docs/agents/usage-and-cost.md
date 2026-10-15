---
title: Usage and cost
description: How much of each plan your agents have used, and what a session would cost at API prices.
sources:
  - docs/managed-agents/providers.md
  - docs/managed-agents/accounts.md
  - plugins/agent-cost/README.md
  - plugins/agent-cost/acorn-plugin.config.mjs
  - plugins/agents/src/client/usage/AgentUsageIndicator.tsx
checked: 52225e24f
---

This page covers the two numbers acorn shows about agent spend: how much of your Claude Code or Codex
plan is left, and an estimate of what a session would cost at API prices. Read it to know what each
number measures and where it can be wrong.

## Plan usage

**Agent utilization**, in the Agent pane's header, shows one figure per harness, such as
`Claude Code 3%`. A dot beside each says whether you're on track, and a small pie shows how much of the
current window is left before it resets.

Click it to open **Plan usage**. Each of the harness's quotas, such as its session window and its
weekly limit, has a sentence and a bar. A small triangle on the bar marks where steady use would have
put you by now, because 20% left is fine an hour into a week and alarming an hour into a five-hour
window. The refresh button beside a harness reads its usage again.

acorn reads plan usage from each CLI, with its own login. The Node checks every five minutes, and the
numbers are the same on every device paired with it. A harness that reports no usage has no section.

With [accounts](/docs/agents/harnesses-and-defaults/#logins-and-accounts), each account is a tab in the
panel. The header shows the open session's account, or the default account for a harness with no
session open.

When a session runs out of plan usage, acorn can wait for the reset and carry on
([Steering, queues, and follow-ups](/docs/agents/steering-queues-and-follow-ups/#plan-usage-limits)).

## Session cost

The **Agent session cost** plugin, which acorn ships and turns on, adds a badge beside a session's
title in its header. It shows the session's cost:

- When the harness reports a cost in US dollars, the badge shows it.
- Otherwise it estimates one from the tokens each turn used and the model's price, and marks it with
  `≈`.
- When the model has no known price, or the harness's counters go backwards, it shows nothing.

On Codex, the badge's tip adds how much of the input was read from the prompt cache and how many
tokens were written to it.

The estimate is what the same tokens would cost on the provider's API. It isn't your bill: plan usage,
credits, and negotiated prices can differ.

### Prices

The prices come from **Settings** > **Agents** > **Limits and cost**, which lists Claude and Codex
models with their input, output, cache write, and cache read prices per million tokens. Change a
built-in price there, or add an exact model under **Other models**. Prices are kept on the Node.

The plugin reads only what the Agent pane hands it: the provider, each turn's tokens, and the price. Its
manifest asks for no permissions at all. Turn it off under **Settings** > **Plugins** > **Installed**
to remove the badge.

## In the terminal

The terminal client draws **Agent utilization** and the **Plan usage** panel in its Agent pane. Edit
prices on **Limits and cost**, which the terminal client draws too.

## Limits

- The estimate covers the session's own thread. It leaves out subagents, tool fees, and premiums for
  long context, service tier, or region.
- One price covers a whole turn, so switching models within a turn isn't priced separately.
- A Codex fork starts with its source's token count, so adding a fork's badge to its source's counts
  the source's tokens twice.
- acorn doesn't move a session to another account when one runs out.
