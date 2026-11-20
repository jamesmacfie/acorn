> **Completion note, November 20, 2026.** Fixed on the Acorn side, on branch
> `phase-l-3-delegation-keeps-the-parent-s-execution-policy`.
>
> What landed:
>
> - An agent picks only a child's model and reasoning. `agent_spawn` refuses the harness's known policy
>   option (`mode` for Claude Code, `permissions` for Codex) with `bad_request` before it reserves
>   anything. `agent_prompt` refuses any option the child doesn't list as a model or reasoning choice,
>   before it applies or queues anything.
> - The owner's options and the agent's are stored apart. `requestedConfigOptions` holds the spawn
>   defaults, the custom agent's options, and the inherited model and reasoning. `agentConfigOptions`
>   holds the calling agent's picks. At startup the runtime applies the agent's picks only where the
>   child lists them as model or reasoning, and puts a warning in the transcript for the rest. The
>   worktree plan in `agent_spawns` carries both, so recovery keeps them apart.
> - Each harness setting has a rank on one scale shared across harnesses
>   (`plugins/agents/src/server/sessions/executionPolicy.ts`). At spawn, the child records an
>   `executionCeiling`: the parent's rank, or the owner's pinned value for the child when that ranks
>   higher. Both new keys are server-owned, so a session patch can't change them.
> - Before the engine sends any turn a person didn't type, it reads the child's current setting. It
>   refuses the turn when the setting ranks above the ceiling, when the harness reports no known
>   setting, or when the ceiling is unreadable. The turn fails with the reason and never reaches the
>   harness. `agent_prompt` runs the same check first, so it queues nothing for a child past its
>   ceiling.
> - `plugins/agents/src/server/delegation/executionPolicy.test.ts` drives the real runtime with a fake
>   harness that reports a mode. It covers a wider spawn request, eligible model and reasoning picks on
>   spawn and prompt, a child that starts wider than its parent, a harness with no mode, an owner
>   default wider than the parent, a wider prompt request, and a child widened by another route.
>   `docs/managed-agents/delegation.md` has a new "Execution policy" section.
>
> Decisions and deviations:
>
> - A parent that reports no known setting gives its child no ceiling. Terminal agents are the main
>   case, because Acorn can't read a terminal's mode. Refusing them would end delegation from every
>   terminal session. Their children still can't take a mode from the agent, so they run on the
>   harness's own setting and the owner's defaults. A contributed harness as a parent works the same
>   way.
> - A spawn that only widens through the harness's start setting still queues its first turn, because
>   delegated sessions start in the background and their options arrive after `agent_spawn` returns.
>   The engine refuses that turn at dispatch instead, so nothing runs. Waiting for the child at spawn
>   would put the harness's startup time on every spawn and on restart recovery.
> - The ranks are a judgment call: `default`, `plan`, and `dontAsk` rank 0, `acceptEdits` and
>   `:read-only` rank 1, `auto` and `:workspace` rank 2, and `bypassPermissions` and
>   `:danger-full-access` rank 3. A custom Codex profile has no rank, so a child on one is refused
>   under a ceiling.
> - The ceiling is a snapshot taken at spawn, like the tool ceiling. Narrowing the parent later
>   doesn't narrow an existing child.
> - A person who widens a child past its ceiling stops its delegated turns. Turns that the person
>   types still run.
> - `agent_prompt` with options on a child that hasn't listed its options yet is refused. The agent can
>   retry once the child is ready.
> - Children spawned before this change have no ceiling. Their later prompts still get the model and
>   reasoning restriction.
>
> For later phases: `executionPolicy.ts` and the `ASKING_SETTING` table in `sessionExecute.ts` both
> describe what each harness's mode means. A later change could fold them into one table. Agents that
> passed `mode: 'auto'` to `agent_spawn` get `bad_request` after this. Auto for children comes from
> **Spawned agents** defaults or from a parent already in Auto.
>
> What acorn-cloud would still need: nothing. This path is local to the Node.

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
