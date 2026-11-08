# Phase 2: the agent session starter

Date: November 9, 2026. Status: proposed. Depends on nothing. Context:
[the programme README](./README.md).

## Goal

Core code can do two things:

- List the agents a person can start, the same rows the agent pane's **New** button offers.
- Start a session in a task on the chosen agent, with text waiting unsent in its composer, and open
  that session.

Core can't import the agents plugin. So core declares a capability key, and the agents plugin
provides it.

## Starting point

- **The precedent for a core-declared key** is `AGENT_ASK` in
  `packages/client-core/src/features/dashboards/refreshCapabilities.ts:8`. Its comment explains the
  rule: core declares, the plugin provides. It's re-exported for plugins at
  `packages/plugin-api/src/client.ts:282`, and the agents plugin provides it in
  `plugins/agents/src/client/index.ts:111-130`.
- **`AGENT_ASK` doesn't fit.** `ask` sends its prompt as the first turn straight away, and it always
  takes the first startable agent.
- **`AGENTS_CONVERSATION.startSession` doesn't fit either.** It's in
  `plugins/agents/src/contract/conversation.ts:42`, a plugin contract that core can't import. It
  attaches its text as a context chip, not plain composer text. It picks the agent from a `like`
  session or the first installed one.
- **The agent choices** come from `newSessionChoices(providers, customAgents)` and
  `providerStartable` in `plugins/agents/src/contract/newSessionChoices.ts:23,42`. They read the
  provider list cached by `agentProvidersOptions()` (`plugins/agents/src/client/providersClient.ts:18`).
  The pane's **New** picker is `plugins/agents/src/client/sessions/AgentPane.tsx:370`, built from
  `agentPaneModel.ts`.
- **Starting a session** is `managedAgentStore.startSession(taskId, { id, profileId }, { customAgentId?, account? })`
  (`plugins/agents/src/client/sessions/managedStore.ts:569`). `startSessionFromPalette`
  (`plugins/agents/src/client/commands.ts:48`) shows how a choice row maps to those arguments.
- **Adding draft text** is `appendManagedDraft(sessionId, text)`
  (`plugins/agents/src/client/sessions/managedDrafts.ts:5`). Drafts are saved per session, so this
  works before the pane mounts.
- **Opening the session** is `openManagedSession(taskId, sessionId)`
  (`plugins/agents/src/client/sessions/managedSelection.ts:117`). It selects the session and shows the
  agent pane.

## Design

Declare the key in a new file, `packages/client-core/src/features/agent/sessionStarter.ts`:

```ts
export type AgentSessionChoice = { id: string; label: string }

export type AgentSessionStarter = {
  /** The agents a person can start now, in the order the agent pane's New button lists them. */
  choices(): Promise<AgentSessionChoice[]>
  /** Starts an interactive session in the task on the chosen agent, or the first startable one,
   *  puts `draft` in its composer unsent, and opens it. Answers the session ID. */
  start(input: { taskId: string; title: string; choiceId?: string; draft: string }): Promise<string>
}
export const AGENT_SESSION_STARTER = clientCapabilityId<AgentSessionStarter>('agents.sessionStarter')
```

- Export it from `features/agent/public.ts`, next to `composeForAgent`, and re-export it from
  `packages/plugin-api/src/client.ts` beside `AGENT_ASK`.
- In the agents plugin, provide it next to `AGENT_ASK` in `plugins/agents/src/client/index.ts`:
  - `choices()` fetches the providers and custom agents, then maps
    `newSessionChoices(...).filter(providerStartable)` to `{ id, label }`. The ID must survive the
    round trip to `start`, so use the row's existing key.
  - `start()` finds the row by `choiceId` (or takes the first), calls `managedAgentStore.startSession`
    the way `startSessionFromPalette` does, then `appendManagedDraft`, then `openManagedSession`.
    If the choice no longer exists, it throws "That agent isn't available any more. Pick another."

## Steps

1. Add `sessionStarter.ts` and the two exports.
2. Provide the key in the agents plugin.
3. Write tests in the agents plugin:
   - `choices()` returns the same rows the pane's New picker shows, for a fixture with two harnesses
     and one custom agent.
   - `start()` with a `choiceId` starts that harness, the draft text is in the session's composer
     state, and nothing was sent.
   - `start()` with an unknown `choiceId` throws.
4. Update `packages/plugin-api/src/surface.snapshot.txt`.

## Acceptance

- In `pnpm dev:agent`, from the devtools console of an open task, `start()` opens a new session on
  the chosen agent with the draft in its composer. The transcript has no turn.
- The plugin boundary tests and the plugin-api surface test pass.

## Risks

- **Entry point and startup budgets.** client-core is capped at 219 package entry points. A new
  export from a feature barrel lands in the desktop renderer's startup graph, which had about 2.3 KB
  free on November 4, 2026. The key and its type are tiny, but measure.
- **Choice IDs drifting.** If `newSessionChoices` gains rows between `choices()` and `start()`, a
  stored ID could point at another row. Keying on a stable value (provider, profile, account, or
  custom agent ID), not a list index, prevents it.

## Verify before building

- What key does each `NewSessionChoice` row already have? Use it as `id` rather than inventing one.
- Does `startSessionFromPalette` do anything beyond `startSession` and `openManagedSession`, such as
  focusing the composer, that `start()` should also do?
