# Create a plugin in its own project

Date: November 9, 2026. Status: proposed. No phase is started.

## What this is

Settings → Plugins has two buttons that start a plugin with an agent: **Ask an agent** and **Build a
data source from your connections**. Today both put a starter prompt into the composer of whichever
task is open (`draftForAgent` in
`packages/client-core/src/features/settings/plugins/PluginsSettings.tsx:218`). That has three
problems:

- It fails with "No running agent session for this task" when the open task has no agent running.
- It writes the plugin into whatever project that task belongs to, which is rarely where a plugin
  should live.
- It prefixes the prompt with `@`, because it calls `sendReferenceToAgent` (which marks the text as a
  file reference) and not `composeForAgent`.

This programme replaces both buttons with one modal that sets everything up first. The modal asks
for these things:

- A folder. It's typed, because a remote Node has no folder picker. **Choose…** appears only for a
  local Node.
- A project name, with a plugin ID filled in from it.
- A plugin kind: pane or trigger. For the data source button, what one row is and which data it
  reads.
- A workspace.
- Which agent to use.
- Whether to make the folder a git repository.

On **Start**:

1. The Node writes the plugin's starter files into the folder, and runs `git init` if asked.
2. The folder becomes a project.
3. A new task opens there.
4. The task's agent has the starter prompt waiting, unsent, in its composer.

The flow already exists in one place. Trellis's **Turn into plugin**
(`plugins/trellis/src/client/pluginExport.ts:57` and `TurnIntoPlugin.tsx:33`) writes the scaffold
into an empty folder, makes it a project, creates a task, and starts a session. This programme moves
that sequence into core for the Plugins page and adds the agent, workspace, kind, and git questions.

## Decisions

Taken November 9, 2026, with James:

| Decision | Choice |
| --- | --- |
| What the Node puts in the folder | The scaffold's starter files from `create-acorn-plugin`, as Trellis does. The modal asks for a plugin ID. |
| Plugin kind | **Pane** (the default) or **Trigger** for the plain button. The data source button always writes the data source starter. |
| Git | A checkbox, "Make it a git repository", checked by default. The Node runs `git init` and commits the starter files, so the task's Changes view shows what the agent edits. |
| Which agent | A select listing the same choices as the agent pane's **New** button. The first is preselected, and the select is hidden when there's only one choice. |
| Workspace | A select of existing workspaces plus **New workspace…**, which asks for a name. It defaults to the active workspace and is hidden when workspaces are off. |
| Data source button | Uses the same modal. Its "what is one row" and "which data" questions move into it, and `DataSourcePromptDialog` goes away. |
| Prompt delivery | Plain text in the new session's composer, never sent automatically. The prompt ends with "What it should do:", so the person finishes it. |
| Folder rule | The folder must be missing or empty, the same rule as Trellis (`plugins/trellis/src/server/pluginPackage.ts:22`). |
| Task shape | A project-folder task, with no new branch or worktree. |

## Rules no phase may break

| Rule | Why |
| --- | --- |
| The scaffold route never writes into a non-empty folder. | Nothing of the owner's is overwritten. |
| The scaffold route accepts only a device principal. Task tokens get 403. | An agent must not be able to write files anywhere on the Node through it. |
| Nothing is sent to an agent automatically. The person sends the draft. | The prompt is unfinished until they say what the plugin should do. |
| Core never imports the agents plugin. Core declares a capability key, and the agents plugin provides it. | The plugin boundary checks in `tools/arch/boundaries.test.ts`. |
| The Node startup bundle grows by no more than the lazy route registration, about 700 B. | The service ceiling had about 2 KB free on November 6, 2026. Measure and report. Ask James before raising the ceiling. |
| A remote Node works with a typed path alone. | Remote Nodes have no folder picker. |
| `/v1` routes don't change meaning. New behaviour is a new route. | Older clients keep working ([versioning](../../api-reference/versioning.md)). |

## The phases

| Phase | What it delivers | Depends on |
| --- | --- | --- |
| [1. Scaffold route](./01-scaffold-route.md) | `POST /v1/core/plugins/scaffold`: writes the starter files into a missing or empty folder, with optional `git init` and a first commit | Nothing |
| [2. Agent session starter](./02-agent-session-starter.md) | A capability key core declares and the agents plugin provides: list the startable agents, and start a session with a draft | Nothing |
| [3. Create plugin modal](./03-create-plugin-modal.md) | `CreatePluginDialog` behind both buttons, the client sequence, resume after a failed step, and the new starter prompts | Phases 1 and 2 |
| [4. Docs](./04-docs.md) | The owning pages and the site pages describe the new flow | Phase 3 |

Phases 1 and 2 are independent and can run side by side.

## Owning documents to update

| Contract | Owning page |
| --- | --- |
| The scaffold route | [Plugin installs by an agent](../../plugins/agent-install.md), beside the `/install` route it sits next to |
| What the buttons do | [Plugin installs by an agent](../../plugins/agent-install.md) § Teaching the agent |
| The capability key | The comment beside the key, and [client capabilities](../../plugins.md) if the page lists keys |
| What a person sees | `apps/site/src/content/docs/docs/settings/plugins.md` and `apps/site/src/content/docs/docs/build-plugins/start/have-your-agent-build-it.mdx` |

## Rules for the work

- Run lint and the tests for each package you touch, and `pnpm test` before a phase is done. Under
  pnpm 11, `pnpm lint` fails with "eslint not found", so run the root lint script's steps by hand.
- Run `pnpm --filter @acorn/node build` after phase 1 and record the service bundle's size change in
  the phase file.
- Settle each phase's **Verify before building** items before writing its code, and record the answer
  in the phase file.
- Each phase ends with a checkpoint someone runs by hand and records, with the date, in the phase
  file. A skipped checkpoint is written down as skipped, with the reason.
- When a phase lands, cut its file down to what is left and point at the owning pages.
