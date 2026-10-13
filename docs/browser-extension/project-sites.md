# Project sites in the browser extension

This page covers project site associations: web addresses a person ties to a project, so the
[browser extension](../browser-extension.md) suggests that project on those pages. It covers how they
are stored on the Node, how the sidebar matches and suggests, the override it remembers, and the
native operations. The shared rules are in `packages/protocol/src/projects/siteAssociations.ts`. The
sidebar's side is in `apps/extension/src/sidebar/Destination.tsx` and `ProjectSites.tsx`, and the
host's in `apps/cli/src/browser/bridge.ts`.

## What an association is

An association is an exact origin and a path prefix, such as `https://example.com` and `/app`. The
origin includes the scheme and any port, so `http://localhost:5173` and `http://localhost:5174` are two
sites. The prefix matches whole path segments: `/app` covers `/app` and `/app/login`, not `/apps`. It
defaults to `/`, which covers the whole origin.

Only `http` and `https` are allowed, and an address with a user name or password is refused. The Node
stores the canonical form, so `https://Example.com/app/` is stored as `https://example.com` and `/app`.
A project holds at most 32.

An association is a suggestion. It grants no browser access and restricts nothing: any task can still
be chosen on any page.

## Storage on the Node

Associations are machine-local project settings. They live on the `projects` row as
`site_associations`, a JSON list, and travel as `siteAssociations` in the project config
([project configuration](../workspaces-and-tasks/project-config.md#the-project-row)). A committed
`.acorn/config.toml` can't set them. A project with none reads as an empty list.

`PUT /v1/core/projects/:id/config` with `{ patch: { siteAssociations } }` replaces the whole list and
leaves every other field alone. A patch that doesn't name the list keeps it. The Node drops
duplicates, stores no value for an empty list, and broadcasts `project:changed`, as for any config
change. Plugins don't see associations: `core.projects.config` leaves them out.

Only the extension edits associations. The desktop's project settings page sends partial patches, so
it never clears them.

## Suggestions in the sidebar

The sidebar keeps the selected Node's associations in memory and matches the page beside it against
them, in the browser. No page address goes to the Node for this. The browser reports the page's
address only for a site the person allowed, or the tab the toolbar button was clicked on.

Every project with an association covering the page is a candidate. Overlapping prefixes and several
projects are all candidates, and none outranks another:

- **One candidate** is chosen in the project picker, under **Suggested for this page**.
- **Several candidates** are listed first in the picker. A project they leave out is cleared, and the
  sidebar asks the person to choose one.
- **No candidate** changes nothing. The picker keeps whatever was chosen.

The sidebar follows the page only while no task is chosen. A chosen task, its conversation, and its
draft stay put when the page changes. If the page suggests other projects, a notice names them, with
a **Switch to** button for each. Switching clears the task; the draft stays with its conversation.

## Overrides

Choosing a project in the picker that the page didn't suggest is an override. The sidebar keeps it in
`storage.local` under `siteChoices:<nodeId>`, keyed by the page's origin and the projects it
suggested. A later page on the same origin that suggests the same projects gets the person's choice
again. A page on that origin that suggests other projects gets its own suggestion. Choosing the
suggestion again forgets the override. Choosing no project is remembered as an override too.

## The editor

When a project is chosen, **Sites for this project** lists its associations with **Remove**. The field
under it takes an address, such as `https://example.com/app`, and **Add** stores its origin and path.
**Add <origin>** adds the whole site of the page beside the sidebar. The editor says what the person
typed wrong before anything goes to the Node.

Site access is listed apart, in the **Site access** card. Each site there says what access is for:
buttons on its pages, handoffs in the sidebar, or project suggestions. Browsers grant access by host
and not by port, so a `http://localhost:5173` association asks for all of `http://localhost`.
Removing access stops the sidebar reading the page, so its suggestions go at once.

## Handoffs

A handoff resolves the page through the plugin, which names the item's projects. The host adds every
project whose associations cover the page, and **Create linked task** may use any of them. An item
whose seed carries a pull number stays with the plugin's projects, because a pull number names a pull
request only in its own repository. On create, the host reads the chosen project's associations again
and matches the page itself, so the sidebar can't widen the list
([browser handoffs](../plugin-authoring/browser-handoffs.md#what-the-host-does-with-the-answer)).

## Native operations

| Operation | Fields | Result |
| --- | --- | --- |
| `sites.list` | `nodeId` | `{ nodeId, sites }`, each `{ projectId, origin, pathPrefix }` |
| `site.add` | `nodeId`, `projectId`, `site` | `{ nodeId, projectId, sites }`: that project's list after the change |
| `site.remove` | `nodeId`, `projectId`, `site` | The same |

`sites.list` reads each project's config, because the Node keeps no list across projects. A project
removed meanwhile, or a list that doesn't parse, reads as none. `site.add` and `site.remove` read the
project's list fresh, change one entry, and write it back, so another client's change since isn't
lost. A change that leaves the list as it was writes nothing. Two clients changing one project at the
same moment can still lose one change, as with any config field.

The host sends `{ v, event: 'projects', nodeId }` when the selected Node broadcasts `project:changed`,
and the sidebar reads the list again. A reply for a Node that is no longer selected is dropped.

## Gaps

The real-browser results and their gaps are in
[phase 07](../future/extension/07-project-site-settings.md#real-browser-results).
