# 02. Build `agents:before-permission`

Status: proposed, 2026-10-02. Not started. The design is [mods.md](../mods.md) and stays there. This
file records why the `omp` comparison moves it up the order, and the two additions the comparison
suggests.

## Why it belongs in this programme

`omp`'s most used extension event is `tool_call`. Its own quick-start example blocks `rm -rf` with
it. An acorn plugin has no equivalent for the harness's tools: `core:before-tool-call` guards only
acorn's own tools, on the agent tools route, and withholds their arguments on purpose.

The permission request is the one place every harness stops and asks acorn before running a risky
tool. [mods.md § The gap](../mods.md#the-gap-harness-permission-requests) traces it through both
drivers, and [mods.md § The design](../mods.md#the-design-agentsbefore-permission) puts a veto-only
hook there. That is the closest acorn can get to `tool_call` from outside the loop, and it works the
same for Claude, Codex, DeepSeek, and `omp` from [01](./01-omp-harness.md).

Build it exactly as `mods.md` describes: observe and veto only, `onTimeout: 'allow'`, run in
`onProviderEvent` before the event queue, and answer a veto with the first `reject_once` option.

## Addition 1: tell the model why

`mods.md` lists "telling the model why" under
[Later](../mods.md#later-each-with-its-trigger), with the trigger "agents retry blocked commands in
a loop". `omp` answers the same problem with `additionalContext` on `tool_call`: a handler adds
trusted text that the host places after the tool results, before the next model request.

Acorn cannot place text inside the harness's turn. It can queue a turn after it. Once
[03](./03-session-messages.md) ships, a veto handler can follow its veto with a session message that
says what was refused and why. Keep the two separate:

- The veto stays a hook verdict with a short display reason, capped by the host.
- The explanation is a session message from the same plugin, under the same per-session cap as any
  other, so a plugin that vetoes in a loop cannot also talk in a loop.

Do not make the hook queue the message itself. A hook that has side effects on another plugin's
session is a different grant from a veto, and the trust prompt would have to say so.

## Addition 2: the first consumer

`mods.md` phase 4 asks for a small loaded plugin with two hard-coded rules: no force-push, and no
destructive command outside the task root. Write it so it also exercises [03](./03-session-messages.md)
once that lands, by queuing one explanation per blocked command. That gives 03 a second real consumer
besides [05](./05-advisor.md), at almost no cost.

## What `omp` does that this still does not

Say these in the owning docs when the hook ships:

- `omp` sees every tool call. This hook sees only the calls a harness asks about. A harness in a bypass
  mode, or a tool its own settings allow, never reaches acorn.
- `omp` can rewrite a tool's input. This hook cannot, because the harness runs its own command.
- `omp` can patch a tool's result before the model reads it. Acorn cannot reach a result at all.

For those, the answer is [01](./01-omp-harness.md): run an agent whose loop takes extensions.

## Verify before building

Everything in [mods.md § Verify before building](../mods.md#verify-before-building), plus whether
[03](./03-session-messages.md) has shipped, which decides whether the explanation path is in scope.
