# Project sites in the browser extension

This page covers project site associations: web addresses a person ties to a project, so the
[browser extension](../browser-extension.md) suggests that project on those pages. It covers how they
are stored on the Node, how the sidebar matches and suggests, the override it remembers, and the
native operations. The shared rules are in `packages/protocol/src/projects/siteAssociations.ts`. Which projects a page
belongs to, overrides included, is `pageScope` in `apps/extension/src/pageScope.ts`, which the sidebar
and the [toolbar badge](./notifications.md) both use. The sidebar's side is in
`apps/extension/src/sidebar/Workspace.tsx` and `Home.tsx`, with Settings' list in `Sites.tsx` and
`AddSite.tsx`. The host's side is in `apps/cli/src/browser/bridge.ts`.

## What an association is

An association is one of four kinds, each stored in its own shape:

| Kind | Stored as | Covers |
| --- | --- | --- |
| Starts with | `{ origin, pathPrefix }` | The address and every page under it |
| Domain | `{ domain }` | The host and its subdomains, on `http` or `https` and any port |
| Exact page | `{ exact }` | One page's origin and path, whatever its query or fragment |
| Regex | `{ regex }` | Any address the JavaScript regular expression finds a match in |

A prefix is an exact origin and a path prefix, such as `https://example.com` and `/app`. The origin
includes the scheme and any port, so `http://localhost:5173` and `http://localhost:5174` are two
sites. The prefix matches whole path segments: `/app` covers `/app` and `/app/login`, not `/apps`. It
defaults to `/`, which covers the whole origin. Lists stored before the other kinds existed hold only
prefixes, so they read unchanged.

A domain such as `example.com` covers `app.example.com` too, but not `badexample.com`. An exact page
such as `https://example.com/a` covers `https://example.com/a/?b=1`, and not `https://example.com/a/b`.
A pattern is tested against the page's whole address, unanchored, and holds at most 500 characters.

Only `http` and `https` addresses are allowed, and an address with a user name or password is refused.
The Node stores the canonical form, so `https://Example.com/app/` is stored as `https://example.com`
and `/app`, and a domain is stored lowercase. A pattern must compile. A project holds at most 32.

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
them, in the browser. No page address goes to the Node for this. The `tabs` permission gives the
sidebar the page's address on any site.

Every project with an association covering the page is a candidate. Overlapping prefixes and several
projects are all candidates, and none outranks another. A page that belongs to a task, or matches a
handoff, shows that first ([This page](./task-pages.md#this-page)); otherwise a page with a candidate
shows the kit's project `Picker` in Home's **This page** section. Its rows show each project's
workspace:

- **One candidate** is chosen in the picker, under **Suggested for this page**.
- **Several candidates** are listed first in the picker, under **Suggested for this page**, and the
  rest under **Other projects**. A project they leave out is cleared, and the picker reads **Choose a
  project**.
- **No candidate** shows no picker, and Home shows only its task list. To tie the page's site to a
  project, click **Add site** under **Sites** in Settings.

Under the picker, **This page** lists the chosen project's open tasks as
[Home's task rows](./task-pages.md#homes-task-list), from the Node's task list, and clicking one opens
it. **New task in Acorn** opens the project in the desktop app. A page on a project's site that belongs
to no task moves nothing by itself: the task or conversation the panel shows, and its draft, stay put
when the page changes, and only **This page** follows it.

Task addresses use the prefix kind's grammar, an exact origin and a path prefix, and are matched the
same way ([pages that belong to a task](./task-pages.md#pages-that-belong-to-a-task)).

## Overrides

Choosing a project in the picker that the page didn't suggest is an override. The sidebar keeps it in
`storage.local` under `siteChoices:<nodeId>`, keyed by the page's origin and the projects it
suggested. A later page on the same origin that suggests the same projects gets the person's choice
again. A page on that origin that suggests other projects gets its own suggestion. Choosing the
suggestion again forgets the override.

## Settings › Sites

Settings is one page: **Nodes**, **Sites**, **Notifications**, and **Appearance**, each the kit's
`SettingsSection`. **Sites** lists every website the extension does something on, one row per access
pattern the browser grants, built by `siteRows` in `apps/extension/src/sidebar/siteRows.ts` from the
selected Node's handoffs, its project associations, and the apps its tasks' plugins publish. Each row
shows:

- The plugin's logo for a site a plugin uses, when the kit has its mark, such as GitHub's, and a muted
  globe otherwise.
- The host, then what the extension does there, joined with commas: "Task chips on its pages" for a
  handoff with buttons, "Look up items" for a handoff the sidebar offers, "Suggests *project*" for an
  association, and "Branch marker for *app*" for a task's
  [branch marker](./task-pages.md#the-branch-marker).
- For a site that suggests a project, a ⋯ menu with each association, its project, **Edit**, and
  **Remove**.
- A switch for the browser's access to the site.

The switch is browser access and nothing else. Turning it on asks the browser. Turning it off asks
nothing and removes the access, and leaves every association in place, so the panel just can't read
that site's pages. Removing access stops the sidebar reading the page, so its suggestions go at once.
Browsers grant access by host and not by port, so a `http://localhost:5173` association asks for all of
`http://localhost`. A domain asks for `https://*.<domain>/*`, so a domain served only over plain
`http` gets no access of its own. A pattern names no host, so it has a row with no switch: its pages
match only where other access lets the sidebar read the address.

**Add site** in the section's header opens a dialog with the kit's project `Picker`, each project with
its workspace, which starts on the current task's project. Then **Match**: **Domain**, **Starts with**,
**Exact page**, or **Regex**, then the address or pattern. Until the person types, the field holds the
page beside the sidebar in the chosen kind's form, so the dialog starts on the page's domain. A pattern
starts empty. Under the field a green check says "Covers this page" when the entry matches that page,
and nothing shows for a pattern. The dialog says what was typed wrong before anything goes to the Node.
**Edit** opens the same dialog on the association. Saving adds the new association before it removes
the old one, so a refusal loses nothing.

## Handoffs

A handoff resolves the page through the plugin, which names the item's projects. The host adds every
project whose associations cover the page, and **Start task** may use any of them. An item
whose seed carries a pull number stays with the plugin's projects, because a pull number names a pull
request only in its own repository. On create, the host reads the chosen project's associations again
and matches the page itself, so the sidebar can't widen the list
([browser handoffs](../plugin-authoring/browser-handoffs.md#what-the-host-does-with-the-answer)).

## Native operations

| Operation | Fields | Result |
| --- | --- | --- |
| `sites.list` | `nodeId` | `{ nodeId, sites }`, each an association with its `projectId` |
| `site.add` | `nodeId`, `projectId`, `site` | `{ nodeId, projectId, sites }`: that project's list after the change |
| `site.remove` | `nodeId`, `projectId`, `site` | The same |

`sites.list` reads each project's config, because the Node keeps no list across projects. A project
removed meanwhile, or a list that doesn't parse, reads as none. `site.add` and `site.remove` read the
project's list fresh, change one entry, and write it back, so another client's change since isn't
lost. A change that leaves the list as it was writes nothing. Two clients changing one project at the
same moment can still lose one change, as with any config field.

The host sends `{ v, event: 'projects', nodeId }` when the selected Node broadcasts `project:changed`
or `workspace:changed`,
and the sidebar reads the list again. A reply for a Node that is no longer selected is dropped.
