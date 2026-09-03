# Command catalogue

Assessed 2026-09-03 against `7d62e3ec`. “Initial” means the first adoption after the engine exists,
not that every row must ship in one commit. Commands are admitted by context completeness and user
value, not by whether an underlying function exists.

## Core

| Command/group | Kind and scope | Result |
| --- | --- | --- |
| Go to task | search, fleet | Replaces current task rows; switches node before activating a remote task. |
| Switch workspace | search, fleet | Replaces current workspace rows and preserves workspace source restoration. |
| Go to project | search, node/workspace | Navigates to the project home without requiring a task. |
| Switch node | search, none/fleet roster | Uses the existing node switch path. |
| Go to pane / pane operations | group plus actions, task | Show, close, pin/unpin, and move available panes; current conditions remain authoritative. |
| Open Settings / setting page | group plus actions, none/workspace | Opens the modal at a named registered page. |
| Create task | action, project | Opens the existing task creation route. |
| Archive task | action, task | Uses the existing guarded archive flow; it is not made confirmation-free. |
| Terminal drawer | group plus actions, task | Show/hide drawer and create a shell. |
| Appearance | setting, none | Style, follow-system, and current light/dark or fixed theme. |
| Notifications | setting/action, none | Sound, system, badge where supported, three event switches, and send test notification. |

Do not expose plugin install/uninstall/reload, node deletion, credential removal, or schedule deletion
as initial commands. Their Settings surfaces carry required explanation and confirmations.

## Plugin decisions

| Owner / tier | Initial adoption | Defer or refuse |
| --- | --- | --- |
| Agents / compiled | Open Agent Center; find managed session using the existing search route; create Claude Code or Codex terminal; carry-last-session and tool-card-fold settings. | Stop, archive, unarchive, import/export, fork, compact, and handoff need a selected session and often confirmation. Pricing and concurrency are forms, not choices. |
| Browser / node-only | None. | Captures and automation tools are agent capabilities with no user-facing pane or durable navigation target. |
| Changes / compiled | Open the Changes pane. | Stage/unstage, commit, push, and review-note mutations remain in the pane where the diff and selected files are visible. |
| Context / compiled | Open the Context pane. | Sending context needs a selected target agent and the current context set; a root command would hide both. |
| Database / loaded | Open Database; find a project saved query; execute the current editor command when its surface is active; Generate SQL as task-scoped input. | Row insert/update/delete and arbitrary destructive SQL remain in the pane. The palette fast generator does not expose provider/model/example selection. |
| Docker / compiled | Open Docker; find and reveal a container, image, volume, or network. | Start/stop/restart can follow after result actions are designed. Remove, prune, and compose-down remain confirmed pane operations. |
| Editor / compiled | Go to file via the existing Command-P shortcut; Find in files; reveal the active file. | File edits and terminal-editor handoff remain in the document surface. |
| GitHub / compiled | Open GitHub; find a pull request; create a PR by navigating to the existing flow; find a changed file in the current PR. | Merge, draft conversion, review, comment, label/reviewer changes, and check reruns require PR context and stay in its surfaces. |
| HTTP / loaded | Open HTTP; find a project saved request; create a request; import cURL through one submitted text input and open the created request. | Secret variables never appear as values. Sending an unsaved edit requires the mounted editor state and stays in the pane. |
| Linear / loaded | Find a mapped project issue; open linked issues. | Commenting and issue mutation remain in the issue surface. |
| Memory / compiled | Search project-visible memory; open the pending-proposals view. | Accept/reject needs proposal context; adding memory needs name, type, scope, and body, beyond one text input. |
| Model providers / loaded service | No plugin command; core's Settings group opens Integrations. | Connection keys, provider metadata, and project mapping are not palette values. |
| Nodes-file / loaded provider | No plugin command; core owns node switching. | Provider configuration is infrastructure, not a duplicate user command. |
| Notes / compiled | Find task/workspace/global notes and open through the retained notes intent; create a task note from a title input and open it. | Delete and agent-inclusion changes remain in the note list, where scope and current value are visible. |
| Onboarding / compiled | None. | Do not invent “restart onboarding” without an owned reset contract and product reason. |
| Preview / compiled | Open Preview for the current task. | URL-rule editing remains repository configuration; reload can remain surface-local until command context can prove a mounted preview. |
| Rollbar / loaded | Find an active mapped-project issue and navigate to its project surface; open linked items. | Create-task promotion is a future secondary action, not the primary search result. |
| Terminal / compiled | Run or stop a configured target; apply a layout recipe; create a shell or agent profile; find and focus a session. | Kill and bulk session management remain in the drawer. |
| Workflows / compiled | Run a workflow definition; find an active/recent run and open it. | Gate approval, cancel, and kill remain in the run surface with status and consequences visible. |

## Search implementation notes

- **Reuse an existing query:** managed agent sessions and memory already expose search semantics.
- **Search cached/list data inside the plugin:** Rollbar can filter its cached active-item response;
  terminal targets, layouts, workflow definitions, notes, and Docker resources can load on entry and
  filter locally through a compiled provider.
- **Add a plugin-owned query route:** GitHub pull requests, Linear issues, saved database queries,
  and saved HTTP requests need bounded query endpoints or query parameters with their existing
  project/connection scoping.
- **Preserve provider order:** remote services or FTS rank their own results. Local lists use the
  existing shared fuzzy scorer with stable source-order ties.

Every route returns at most 50 useful rows even though the host also caps defensively. A provider
connection failing in a multi-connection search becomes a partial failure if other connections
succeed; a total failure uses the normal error envelope.

## Database SQL fast path

`Generate SQL` is an input command available only with an active task and Database capability. On
submit the loaded plugin route:

1. validates the prompt with the existing generation limit;
2. obtains available model connections for the interactive owner;
3. chooses the first connection and that provider's existing default model, matching the modal's
   current initial selection;
4. builds SQL from the live schema with no selected example queries;
5. writes the SQL to the task's existing scratch document;
6. returns success, after which the host opens the Database pane.

No available connection, unavailable schema, provider auth, rate limit, and provider failure return
actionable errors. The palette keeps the prompt and permits retry. The full Generate SQL modal remains
the path for choosing a connection, model, or examples.

## Adoption order inside phases

Use one proof for each contract before broad migration:

1. Terminal workflows prove compiled search and replacement of `paletteRows`.
2. Editor Command-P proves direct shortcut entry and local high-cardinality search.
3. Appearance theme proves setting read/write and live restyling.
4. Rollbar proves loaded, debounced, project-scoped search and navigation.
5. Database generation proves loaded input, pending/error state, persistence, and success navigation.
6. Adopt the remaining approved rows only after the relevant proof's tests pass.

## Verify before building

- Re-read each plugin's owning document and current command/route registrations.
- Confirm every “open” action has a pane, source, route, or Settings target on both applicable hosts.
- Confirm each proposed search can enforce its declared scope on the node, not merely in the client.
- Revisit any deferred operation only with the result-action design and its confirmation semantics.
- If a capability has disappeared or moved tiers, update this catalogue before implementing it.

