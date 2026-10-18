# Phase 2: Tell running sessions when memory changes

Date: October 16, 2026. Status: done on October 19, 2026.

## Completion note

October 19, 2026. Landed on branch `phase-2-memory-updates`.

What landed:

- `AgentStandingContext` gained an optional `current(taskId)`. The capability ID stays `v1`.
- The memory plugin provides `current` from the same lazy `standingContext` loader, with a `live`
  flag. A live read returns `null` when the per-user preference `memory:live-updates:v1` is `0`.
  Anything else, or no value, is on. The key lives in `plugins/memory/src/shared/api.ts`, because the
  client and the server both read it.
- `plugins/agents/src/server/sessions/memoryChanges.ts` owns the whole note. Before each dispatched
  turn, `memoryNote` diffs the index entries, meaning the lines that start with `- `, against
  `standingContextTold ?? standingContext`. It returns the part and a `deliver` callback. The
  dispatcher runs `deliver` in the turn's success callback. That saves `standingContextTold` and
  records the transcript line. A failed turn never calls it, and a failed read or save logs a warning
  without failing the turn.
- `standingContextTold` is in `serverOwnedKeys`. The HTTP create route strips it, and so does
  `ManagedAgentRuntime.createSession`, so a forged or copied value can't become a session's
  baseline. The session list leaves it out of each row, like `standingContext`.
- The memory plugin registers a **Memory** settings page under Settings > Agents, with one switch.
  The terminal client draws it too, because it uses the same kit rows as the editor's page.
- Docs: [standing memory](../../managed-agents/sessions.md#standing-memory) and
  [context integration](../../notes-and-memory.md#context-integration). On the site, the memory
  guide, the memory plugin page, and the Agents settings page, which now covers `memory`.

Deviations:

- The removed lines go under "No longer in the index:", not "Removed:". The project index is capped,
  so each new memory can push an old one out of the list. "Removed" would tell the agent a memory
  was deleted when it still exists.
- The part goes into the request input in `dispatchQueuedTurn`, not through `sendTurn`. The skills
  part is still prepended in `sendTurn`, so a first turn after a start carries skills, then memory,
  then the turn. This needed no change to `sendTurn`, and the owed-again rule comes from the database
  row: nothing is saved until the turn runs.
- Only `- ` entry lines count. Without that, the truncation marker's count would show as a change on
  every write past the cap. A change to a memory's body alone sends no note, because the index has no
  bodies.
- The note isn't added to steered turns, only to dispatched ones.

Measurements:

- One `current` read over a copy of this machine's real memory took a median of 9.1 ms, and 13.4 ms
  cold. That was 155 project memories and six private ones, an index of 14,405 characters.
- The Node's static service graph went from 1,883,875 to 1,884,348 bytes. The ceiling is 1,884,400,
  so 52 bytes are left. The first version was 206 bytes over. Raising the ceiling was refused, so the
  logic moved behind the lazy import instead. The next phase that adds code to the boot graph has to
  find room or justify a raise.

Real-harness check, on a standalone Node built from this branch with its own data folder:

- Claude Code: session A saved a memory with `memory_write`. Session B's next turn carried the
  **Memory changes** part, and B quoted it back. The transcript showed "Memory changed since the last
  turn: 1 added, 0 removed." `standingContextTold` held the new index, and `standingContext` didn't
  change.
- Codex: a Codex session's next turn carried the part, with two added lines and one removed line for
  an edited description. A standalone Node gives Codex no Acorn tools, so a Claude session did the
  writes.
- Off: with the preference at `0`, B answered NONE and no transcript line appeared. On again, B's
  next note listed everything it had missed: 3 added, 1 removed.

For later phases:

- To run a Node from source with Claude Code available, set `NODE_PATH` to `apps/desktop/node_modules`.
  The ACP adapter is a desktop dependency. To pair the CLI without a terminal, pipe the pairing code
  through `script -q /dev/null`, with `ACORN_TUI_CONFIG_DIR` pointing at a scratch folder.

This phase lets a running agent session hear about memory that changed after it started. The
memory plugin owns a setting that turns it on and off. Read it before you change how standing
memory reaches a session.

## The problem

When a session starts, the agents plugin calls the memory plugin's
`agents.standingContext.v1` capability once and stores the result as `config.standingContext`
([standing memory](../../managed-agents/sessions.md#standing-memory)). The result is the memory
index: the name and one-line description of each memory, built by `standingContextBuilder` in
`plugins/memory/src/server/standingContext.ts`. The drivers send that same snapshot again on every
resume.

The snapshot is frozen on purpose. Claude Code keeps the appended system prompt a session was
created with, and changing it would also cost the prompt cache. But several agents share one memory
store. When one agent writes a memory, a session that started earlier never hears about it, and it
might repeat work or contradict a correction.

OpenCode solves this by hashing each instruction source before every step. When a hash changes, it
adds a short note to the conversation and leaves the system prompt alone, so the cached prefix
survives.

## The design

Copy the way Acorn already delivers skills. The agents plugin sends the skill index as an
`<acorn-context source="context.skills">` part ahead of the first turn after a start, and keeps the
names it told the agent in `config.skillIndex`
([skills](../../managed-agents/skills.md)). Memory changes work the same way, on every turn instead
of only the first:

1. Before the agents plugin sends a turn, it asks the memory plugin for the current index.
2. It compares the index with the last one the session was told. That's
   `config.standingContextTold` when present, otherwise `config.standingContext`.
3. If lines were added or removed, it puts one context part ahead of the turn, with
   `contextId: 'memory'`, `source: 'context.memory'`, and the label **Memory changes**.
4. After the turn runs, it writes the new index to `config.standingContextTold` and records one
   transcript line, such as "Memory changed since the last turn: 2 added, 1 removed."
5. If the turn fails, it writes nothing, so the change is offered again on the next turn.

The system prompt and `config.standingContext` never change. A resumed session gets the original
snapshot and then replays the delta notes from its own history, so what it knows stays consistent.

The part's text is Acorn's sentence followed by the changed lines:

```text
The memory index changed since your last turn. Read a memory with memory_get when it matters.
Added or updated:
- [name](file.md) — description
Removed:
- [old-name](old.md) — description
```

An edited description shows as a removed line and an added line. Show both. The agent needs the
old wording to know what was superseded.

### Where it goes in the code

- The capability. Add an optional method to `AgentStandingContext` in
  `plugins/agents/src/contract/standingContext.ts`:
  `current?(taskId: string): Promise<string | null>`. It returns the index the session would get if
  it started now, or `null` when the setting is off. The method is optional, so the capability ID
  stays `v1`.
- The memory plugin. Provide `current` beside `build` in `plugins/memory/src/node/index.ts`. Read
  the setting first and return `null` when it's off.
- The send path. The part joins the skills part in `sendTurn` in
  `plugins/agents/src/server/sessions/providerSessionLifecycle.ts`. That function is synchronous,
  so read `current` in the dispatcher before it calls `sendTurn`, and pass the part in. Keep the
  "owed again on failure" rule the skills part follows.
- The config key. Add `standingContextTold` to `serverOwnedKeys` in
  `plugins/agents/src/server/sessions/sessionConfigMerge.ts`, so a configuration patch can't
  overwrite it.

### The setting

The memory plugin owns the switch, because the agents plugin doesn't read another plugin's
preferences.

- Store it as a per-user preference, `memory:live-updates:v1`, beside `memory:index-caps:v1`.
- Default it to on. The feature only adds text when memory changes, and an agent working from a
  stale index is the problem this phase fixes.
- The memory plugin has no settings page. Register one with `ctx.settingsPages.register` in
  `plugins/memory/src/client/index.ts`, as the editor and Docker plugins do. Give it one switch,
  **Tell running sessions when memory changes**, and a line that explains it adds a short note to
  the agent's next message.
- Turning the setting off stops the notes on the next turn. Turning it on again compares against
  the last index the session was told, so the agent gets everything it missed in one note.

## Tests

- In the memory plugin, `current` returns the index when the setting is on and `null` when it's off.
- In the agents plugin, use a fake capability whose index changes between two turns. Check that the
  first turn carries no memory part, the second carries one with the right added and removed lines,
  and `standingContextTold` holds the new index after the turn runs.
- A failed turn leaves `standingContextTold` alone, and the next turn carries the same part.
- A configuration patch can't set `standingContextTold`.

## Done when

- In two real Claude Code sessions on one project, a memory written by one session shows up as a
  **Memory changes** part on the other's next turn. The second session doesn't need a restart.
- The same check passes with Codex.
- With the setting off, no part appears, and the transcript line doesn't either.
- [Standing memory](../../managed-agents/sessions.md#standing-memory) and
  [notes and memory](../../notes-and-memory.md) describe the delta part and the setting.

## Risks

- Every turn reads the memory index once. The index is capped at 16,000 characters by default, and
  the reads hit SQLite on the same Node. Measure a turn's start time before and after.
- A busy project where agents write memory all the time adds a note to most turns. The setting is
  the escape. If it becomes a complaint, batch changes per turn rather than raising a cap.
- A compaction can drop earlier delta notes, as it can drop the skill index. The agent can still
  call `memory_list`, and the next change brings a fresh note.
