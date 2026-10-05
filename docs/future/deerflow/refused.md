# DeerFlow features acorn doesn't take

Status: decided, October 6, 2026. This page records what the [DeerFlow review](./README.md) decided
against and why, so a later session argues with the reasoning instead of with silence.

## Loop middleware

DeerFlow's context compaction, summarization caching, tool-call recovery for dangling calls, empty
response retries, and loop detection all run between model calls. Acorn has no hook there, because
the harness owns that loop. Compaction is the harness's job, and acorn exposes it as a session action.
Loop detection survives in a reduced form as a notice idea in the [README](./README.md).

## Memory backends and the write gate

DeerFlow extracts facts from every conversation automatically, classifies each one by scope and
durability, and writes the durable ones. It supports mem0, Honcho, and OpenViking as backends.
Acorn's memory asks a person to approve a write ([notes and memory](../../notes-and-memory.md)), which
is stricter than any automatic gate. Pluggable backends would add a dependency graph for a problem
acorn doesn't have on a single-owner Node.

## Skill management and the skill scanner

DeerFlow installs, enables, exports, and scans skills, and mounts them into its sandbox. In acorn,
the harness loads skills from its own folders. Acorn draws `$skill` mentions the session advertises
and doesn't install anything. The [oh-my-pi programme](../pi/phases/06-portable-skills.md) covers
plugin-shipped skills.

## Chat-app channels

DeerFlow drives agents from Slack, Lark, Telegram, and other chat apps. Acorn is a desktop and
terminal workspace with a [remote client design](../remote.md). A channel would be a plugin, and no
one has asked for one.

## Sandbox providers

DeerFlow runs tools in Docker, E2B, Kubernetes, or Apple containers. Acorn's task isolation is a Git
worktree, and its microVM direction is a separate plugin design. DeerFlow's providers assume DeerFlow
owns the tool calls, which acorn doesn't.

## Shared model catalog and request pacing

DeerFlow lets an administrator add OpenAI-compatible models through the UI, encrypted at rest, and
paces requests per model. Acorn's [model providers](../../integrations/model-providers.md) cover the
connections a single owner holds, and the harness paces its own provider calls.

## Composer extras

Input polishing, voice dictation, follow-up suggestions, and the AI-content disclaimer are small web
client features. None of them changes what an agent can do, and each one spends a model call or adds
a control.
