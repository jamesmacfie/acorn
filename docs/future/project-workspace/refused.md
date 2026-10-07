# Project-first workspaces: refused alternatives

Date: October 7, 2026. Status: decisions retained through all six implemented phases.
Read the [plan](./README.md) before you change these boundaries.

## Refused alternatives

| Alternative | Reason |
| --- | --- |
| A project filter over the Default workspace | Home, notes, saved queries, workflow definitions, and Linear and Rollbar links would stay shared across every project. Fixing that means adding a project scope to each of those stores, a second scope through about 50 client files, the Node stores, and the terminal client. Two navigation models would then need maintaining. |
| A Home that spans every project | Each Home belongs to one workspace, as it does today. There's no Home outside a workspace now, and this plan doesn't add one. |
| Enforcing one project per workspace in the UI only | The CLI, the API, and plugins could still put two projects in one workspace, and nothing would report it. The Node refuses instead. |
| Deriving the mode from whether Default exists | The mode would depend on a side effect. Any future call to `ensureDefault` would quietly turn workspaces on. The mode is a stored preference. |
| A one-off split of Default for existing installs | Each project would move to its own workspace, but Default's Home, notes, and saved queries would stay with Default and become unreachable. |
| Deleting everything a workspace owns when its project is deleted | It needs deletes in the dashboards, queries, notes, and workflows stores. Today's workspace delete leaves those rows behind too. Fixing both together is a separate change. |
| A Settings toggle between modes | Switching means moving projects between workspaces, and their data doesn't move with them. |
| Asking nothing at first run | The wizard asks, so people who want groups get today's behavior from the start. |

## Deferred

These belong to one later plan, because each one needs a project's data to move with it:

- Moving a project to another workspace with its Home boards, notes, saved queries, workflow
  definitions, and links.
- Switching modes after first run, in either direction.
- Offering workspaces to an install that started project-first.
