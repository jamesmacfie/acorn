# New-session defaults

A session starts on the settings you last used, not on the provider's own choice. This page covers how
the agents plugin remembers those settings, the inline diff chats, spawned-agent defaults, and the
Settings page that edits them. The store is `plugins/agents/src/server/sessionDefaultsStore.ts`.

## New-session defaults

Switch Codex to a higher reasoning effort in one session, and the next Codex session starts there.
Nothing in this is per provider. A provider advertises its options as `AgentConfigOption[]` when a
session starts, so a default is a value keyed by provider ID and option ID. A harness added later is
defaultable as soon as it advertises an option.

One `prefs` row, `agents:session-defaults:v1`, holds these fields:

| Field | Default | What it does |
| --- | --- | --- |
| `followLastSession` | On | Chooses between `last` and `pinned` |
| `last` | | Written by the runtime when a session's option changes |
| `pinned` | | Written by you under Settings > Harnesses and defaults |
| `inline` | | The inline chat choices |
| `spawned` | Inherit | Defaults for agents made by `agent_spawn` |
| `continueAfterUsageLimit` | On | Resumes after a plan limit resets ([operations](./operations.md#plan-usage-limits)) |
| `stopIdleAfterMinutes` | 30 | **Stop idle agents after**: 15, 30, 120, or 0 for never ([idle stop](./operations.md#idle-stop)) |
| `keepArchivedHistoryDays` | 0 | **Keep agent history for archived tasks**: 30, 90, 365, or 0 for forever ([history retention](./history-retention.md)) |
| `hiddenProviders` | None | Harnesses switched off under Settings > Harnesses and defaults. New, the empty state and the palette leave them and their custom agents out. Sessions already on one, workflows and `agent_spawn` still run it, and the last harness on offer can't be switched off |

Neither writer sends the other's field, and the server merges each write, so the Settings page can't
undo a switch made while it was open.

Both halves run in `ManagedAgentRuntime`:

- `createSession` applies defaults after the driver reports `session_metadata`, the first moment there
  is an option list to check against. A value the provider no longer offers is dropped, and a provider
  that refuses the switch gets a warning row instead of failing the session.
- `patchSession` remembers changes. It's the one method every config change goes through, from the
  composer or an automation. Only options that changed are stored.

Defaults apply to interactive sessions, not forks. A fork continues at its source's settings.

A workflow turn carries its own settings. `AGENTS_SESSION_EXECUTE` takes `configOptions`, which the
step's `config_options` fills ([execution model](../workflows/execution.md#execution-model)). It applies through
the same `optionsWithDefaults` fold and `patchSession` write, after the provider reports its options
and before the turn is queued, because the Claude driver reads a switch only through `setConfig`. The
model and effort also go on the turn's `effectivePolicy`, because the Codex driver reads them there.

## Inline chats

Inline diff chats are interactive sessions with a typed `origin` on the session row: the task, source,
path, side, line, patch key, and quoted text. A local origin also records staged or unstaged scope,
and a pull request origin records its repository and number. The agents client capability gives
Changes and GitHub a compact diff card without either owning transcripts.

The card draws the chat's messages and any question the agent asks, which you answer in place. Tool
calls stay in the full session. **Hide** folds a chat to its header for the rest of the app session.
Command-Enter on macOS, or Control-Enter elsewhere, sends, and Enter adds a newline. The task sidebar
groups these sessions under **Inline chats**. When the patch changes, the card detaches from the line,
and the session keeps its context.

Inline chats have their own provider, model, and effort defaults in `inline`. The sparkle picker
opens above the send row with a **Read only** or **Write access** control. Each chat starts read-only.
When the provider offers a read-only permission profile, it applies before the first turn. Otherwise
the card labels the choice best effort and asks the agent not to write.

## Spawned agents

The **Spawned agents** section sets defaults for `agent_spawn` children, worktree children included.
**Inherit from parent** copies the parent's harness, model, and effort at spawn time, and is the
default. **Use explicit defaults** stores a harness and per-provider model and effort in `spawned`.
Spawn-call overrides beat custom-agent options, which beat these defaults. Model and effort inherit
only within the same provider. Permission and mode options don't inherit.
[Orchestration tools](../agent-tools/orchestration.md#managed-session-orchestration) owns the spawn
contract.

## The Settings page

Settings > Harnesses and defaults (`plugins/agents/src/client/settings/AgentSessionDefaultsSettings.tsx`)
lists each harness the Node declares and whether this machine can run it, then these fields. Its rows
say they seed new sessions only and name the control that changes an open one: the composer's pickers,
and `/mcp` for MCP servers.

The page also holds **Send task context at startup**, core's `startup_context_injection` preference,
which decides whether an agent started in the terminal drawer gets the task's pull request, linked
issues, and notes.

The pickers read the newest session that advertised options, because a provider reports its models
only once a session runs. A provider not run within the 50 latest sessions shows no pickers. Each pick
saves. A failed write says so and refetches the row.

## Tool call display

**Tool call display**, under a Transcript heading, is a device preference, not a session default, and
carries a **This device** chip. It sets whether tool cards start collapsed, start expanded, or carry
your last toggle forward. It's stored as `agent_tool_fold` through
`plugins/agents/src/client/sessions/toolFoldPrefs.ts`. [The transcript](./transcript.md#tool-cards)
covers how cards use it.
