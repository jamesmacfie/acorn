# L-3. Delegation can widen harness permissions

Found November 20, 2026, in Acorn at `90b9e61e3`. Severity is high. The missing authorization check
is confirmed from source. Status is open.

## Evidence and impact

The spawn path inherits model and reasoning settings from a parent session, then merges the calling
agent's provider options. The prompt path can also apply provider options to an idle child before
queuing its next turn. Both validate that the provider offers the requested value. Neither checks
whether the calling agent can grant that permission to a child. The Acorn tool ceiling limits Acorn
tools independently of the provider's shell policy.

This affects sessions with delegation access and a harness that offers a less restrictive policy.
The child can then run outside the parent's sandbox or approval requirements, depending on the
harness. Slack sessions use the workflow session kind, which the delegation gate refuses. This
finding is independent of [X-1](./x-1-account-takeover-to-slack-agent-turns.md).

- `plugins/agents/src/server/delegation/spawnConfiguration.ts` merges the caller's options.
- `plugins/agents/src/server/delegation/service.ts` applies options on child prompts.
- `plugins/agents/src/server/sessions/runtime.ts` applies stored options on child startup.
- `plugins/agents/src/shared/sessionDefaults.ts` validates the provider's advertised choices.
- `plugins/agents/src/server/delegation/policy.ts` decides which sessions can delegate.

## Fix and verification

Limit options supplied by an agent to model and reasoning. Preserve the provenance of owner-defined
defaults and check the child's effective execution policy against the parent's authorized policy
before each delegated turn. Refuse the turn if the provider cannot report the required policy.

Use a fake provider to test both spawn and prompt. Assert that attempts to widen the effective
policy queue no turn and that the child still accepts eligible model and reasoning choices.
