# 09-13. The GitHub importer has no frame

**Status:** not started. Batch B09. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

The importer opens inline between the Projects description and the project table, with no title or
box, so it is hard to see where it ends. Its **Close** is an md outline button alone on a right-aligned
row. A repository that already has a project is offered **Clone** and **Map folder** like any other,
and only rows imported in this visit are marked. Rows start 17 pixels in from the section text, and
"Private" and "Public" float far from the name.

## Where to see it

Settings › Overview (workspaces and projects) › **Import from GitHub**. Connected needs the area 09
seed; not connected is the fixture's state.

## Already done

- B01 hid GitHub from Add connection in a build with no client ID. The plugin defaults to acorn's
  public client ID, so fresh dev sessions show **Connect GitHub** without `GITHUB_CLIENT_ID`.
  The variable is an optional override for your own app. An empty override hides the connect flow;
  a stored connection keeps working.

## The fix

The partial fix. Making **Connect** open Add connection with GitHub already chosen needs new host work
(the settings target grammar cannot say it), and is deferred (see [deferred.md](../deferred.md)).
**Connect** keeps opening Settings.

- `plugins/github/src/client/GithubImporter.tsx:80-154`: a `Card` titled "Import from GitHub", with
  **Close** as ghost sm in its header.
- A repository that already has a project shows "Added as {project name}" and keeps its buttons (two
  clones are legal).
- Rows follow the settings list row (06-3).
- `packages/client-core/src/features/workspaces/WorkspaceProjectAssignments.tsx:128-135` hosts it.

## Copy

Rows from area 09 and from area 01's importer table. B01 left the importer rows for this batch.

| Where | Current text | Decision | New text |
| --- | --- | --- | --- |
| (new) title | (none) | Rewrite | Import from GitHub |
| `GithubImporter.tsx:90` | Connect GitHub to discover repositories and import them into Projects. | Rewrite | Connect GitHub to add its repositories as projects. |
| `GithubImporter.tsx:56` | GitHub import {status} | Rewrite | Couldn't add that repository. Try again. |
| `GithubImporter.tsx:59` | That repository could not be imported. | Rewrite | Couldn't add that repository. |
| (new) row meta | (none) | Rewrite | Added as {project name} |
| `GithubImporter.tsx:95` | Connected as @{login}. | Keep | |
| `GithubImporter.tsx:99` | Folder selection is available in the desktop app. | Rewrite | To choose a folder, use the desktop app. |
| `GithubImporter.tsx:101` | Loading GitHub repositories… | Keep | |
| `GithubImporter.tsx:104` | No mirrored GitHub repositories yet. Refresh GitHub and try again. | Rewrite | No repositories to show. |
| `GithubImporter.tsx:125` | Private / Public | Keep | |
| `GithubImporter.tsx:127` | Added — cloned / Added — mapped | Rewrite | "Added as {project name}" (the plan's overrule: row 704 wins over area 01's "Cloned / Linked") |
| `GithubImporter.tsx:133` | Map folder | Rewrite | Link folder |
| `GithubImporter.tsx:141-142` | Both ask for a folder straight away. Repositories you skip stay here — import them whenever you're ready. | Rewrite, keep inline | **Clone** asks where to put the copy. **Link folder** asks where your copy already is. |

The plan's overrules: "No repositories to show." does not claim none exist (area 01's row 510); the
verb for a mapped folder is "link".

## Risk and checks

- Before you start, confirm how the importer learns which repositories already have projects.
- Screens: the importer not connected, and connected with the seed.
- Tests: `plugins/github`, client-core.
