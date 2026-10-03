# From the command palette

The agents plugin registers its own palette rows, one more per custom agent, plus the open session's
actions. [Command palette and shortcuts](../command-palette-and-shortcuts.md) covers how the palette
searches, and [command kinds](../plugins.md#command-kinds) holds the vocabulary.

## From the command palette

| Row | Kind | What it does |
| --- | --- | --- |
| New agent session | Search, task-scoped | Lists installed harnesses, then the custom agents on them. Picking one creates the session, selects it, and shows the Agent pane |
| New *agent* session | Action, task-scoped | One row per custom agent. Desktop only |
| Open Agent Center | Action, no scope | Selects the `agents` rail source |
| Find an agent session | Search, task-scoped | The Node's search over session titles, events, and artifacts, for the captured task |
| New Claude Code terminal | Action, needs a task | Opens a terminal on the `claude-code` profile and focuses it |
| New Codex terminal | Action, needs a task | The same for the `codex` profile |
| Start new sessions with my last model | Setting, no scope | On and Off over `followLastSession` |
| Tool call display | Setting, no scope | Start collapsed, start expanded, or carry the last one forward |
| Agent session | Group, task-scoped | The open session's ••• menu: fork, retry, compact, continue in terminal, regenerate title, rename, two exports, and archive |

The JSON session export includes `version: 1` and `baseline: "acorn-1"`.

## How the rows behave

**New agent session is a picker, and it needs an open task.** A session is created against a task's
worktree, so the palette hides the row with no task open. The harness list comes from the Node, so the
row is a search that loads once when the palette opens and filters locally as you type (`localSearch`,
`packages/client-core/src/host/registries/commands/localSearch.ts`). Only installed harnesses are
listed. The create goes through `managedAgentStore.startSession`, the same call as the pane's **New**
picker.

**Find an agent session is task-scoped, though its route isn't.** Agent Center asks the same route
about a workspace. A palette row from another task would need the router to switch tasks first, which
a plugin can't do, so the palette asks about the captured task. The Node ranks rows, the client
doesn't re-rank, a request is capped at 50, and each row carries its task. Selection goes through
`plugins/agents/src/client/sessions/managedSelection.ts`, the path Agent Center uses.

**The harness terminals belong to this plugin.** The profile IDs are this plugin's
(`plugins/agents/src/server/profiles/index.ts`), so the commands are too
(`terminalProfileCommands.ts`). The shell keeps the drawer toggle and the plain shell.

**Each setting shares its accessor with its Settings page.** Follow-last writes through
`writeAgentSessionDefaults` in `sessionDefaultsClient.ts`, and Tool call display through
`saveAgentToolFoldMode` in `toolFoldPrefs.ts`. Both need a query client, which doesn't exist at plugin
init, so `AgentCommands.tsx` registers them from a component in the `overlay` slot. That makes them
desktop-only: the terminal client draws no overlay slot and can't store a device preference.

**The session's actions are registered by the pane while it's drawn.** They need a selected session,
and rename and archive are dialogs the detail region draws. The pane model's `sessionActions` memo in
`plugins/agents/src/client/sessions/agentPaneModel.ts` is the only roster. The palette reads each
row's label, availability, and work from it when it draws and when you pick, and leaves out actions the
menu would draw disabled. Registration reruns only when the set of IDs changes. Archive skips its
dialog when the session has no turns and an empty draft (`sessionIsBlank`).

## What's left out

Stop stays out: it's destructive and needs runtime state a palette row can't carry. Unarchive and
import belong to Agent Center, which spans tasks. Pricing and concurrency are numbers, with no list of
choices to pick from.
