# Phase 2: the agent session starter

Date: November 9, 2026. Status: built. Depends on nothing. Context:
[the programme README](./README.md).

## Completion note

November 9, 2026.

### What landed

- `AGENT_SESSION_STARTER` and its `AgentSessionStarter` type in
  `packages/client-core/src/features/agent/sessionStarter.ts`. `features/agent/public.ts` and
  `packages/plugin-api/src/client.ts` export both, beside `AGENT_ASK`. The surface snapshot gained
  those two lines.
- The agents plugin provides the key from `plugins/agents/src/client/sessionStarter.ts`, which
  `client/index.ts` registers next to `AGENT_ASK`.
- `choiceId(choice)` in `plugins/agents/src/contract/newSessionChoices.ts`. It's the key the palette's
  **New agent session** rows already used: `custom-agent:<id>`, `<provider>:account:<name>`, or the
  provider ID. The palette now calls it too.
- `readNewSessionChoices()` in the plugin's `sessionStarter.ts` reads the providers and custom agents
  and builds New's rows. The palette and the starter both use it, so they can't list different rows.
- `managedAgentStore.startSession` takes an optional `title`, so `start()` names the session.
- Tests: `sessionStarter.test.ts`, four cases. They cover the rows for two harnesses, one harness not
  installed, and one custom agent. They also cover a start with a choice, a start without one, and an
  unknown choice.

### Decisions and deviations

- `AgentSessionChoice` isn't exported. Knip fails the lint on an exported type nobody imports. The
  shape is in `choices()`'s return type, and phase 3 can export it if the dialog needs the name.
- `choices()` doesn't filter by `providerStartable`. `newSessionChoices` already drops every row that
  can't start a session, and the filter would only re-check that.
- `start()` with no choice and no startable agent throws "No agent harness on this Node is installed
  and signed in.", the same message `AGENT_ASK` uses. An unknown choice throws "That agent isn't
  available any more. Pick another."
- The draft goes into the composer before the session opens, so the composer mounts with it.

### Answers to "Verify before building"

- **Row keys.** `NewSessionChoice` has no key field. The palette built one inline, and that key is now
  `choiceId`. It's made from the custom agent ID, or the provider ID and account name, so it doesn't
  depend on the row's place in the list.
- **`startSessionFromPalette`.** Beyond `startSession` and `openManagedSession`, it calls
  `requestComposerFocus`. `openManagedSession` already asks for that focus through
  `selectManagedSession`, so `start()` doesn't repeat it.

### Budgets

Measured on this branch against its base, 1e9e138ac:

| Check | Before | After | Ceiling |
| --- | --- | --- | --- |
| Desktop renderer startup scripts | 1,013,316 B | 1,013,316 B | 1,030,000 B |
| Desktop compiled roster | 355,922 B | 356,486 B | 370,000 B |
| Terminal client startup closure | 805,805 B | 805,805 B | 820,000 B |

client-core's package exports didn't change, because the key goes through the `./features/agent`
barrel.

### Checkpoint

Run on November 9, 2026, in `pnpm dev:agent -- --vite`. The console steps ran through
`pnpm dev:agent:ui -- run`. The script imported `clientCapabilities.ts` by its Vite `/@fs/` path,
which reaches the live registry. A built renderer has no such handle, so `--vite` is needed.

- The registry listed `agents.sessionStarter`. `choices()` answered
  `[{ id: 'claude', label: 'Claude Code' }, { id: 'codex', label: 'Codex' }]`.
- In a new project-folder task, `start({ choiceId: 'codex', title: 'Build Weather', draft })` opened
  a Codex session named "Build Weather". The agent pane showed it with the draft in the composer
  and "This session is ready for its first turn." The Node's snapshot had `queuedTurns: 0` and three
  `session` events, with no turn.
- `start()` with `choiceId: 'gone'` threw "That agent isn't available any more. Pick another."

The composer also showed the "Task context attached" chip. Every new session gets it, so phase 3
inherits it.

### For later phases

- Phase 3 reads the key with `clientCapability(AGENT_SESSION_STARTER)` at call time. It's absent when
  the agents plugin isn't running.
- Pass `choiceId` back unchanged. Hide the select when `choices()` answers one row.
- `start()` selects the session and shows the agent pane in the layout of the task it's given. It
  doesn't switch tasks, so the sequence must activate the new task itself.
- The client capabilities page, [collaboration](../../plugins/collaboration.md), lists `AGENT_ASK`.
  Phase 4 adds this key there.

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
