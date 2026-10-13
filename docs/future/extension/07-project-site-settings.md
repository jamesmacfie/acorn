# Phase 07: project site settings

Status: implemented October 13, 2026, with the real-browser gaps listed in
[real-browser results](#real-browser-results). [Project sites](../../browser-extension/project-sites.md)
owns the shipped behavior and the site operations.

Read the [extension context](./README.md) before implementing this phase. It owns the release
boundary, authority model, shared contracts, and defaults.

## Prerequisites

[Browser contributions and GitHub handoff](./04-github-handoff.md). Can proceed independently of
phases 05, 06, and 08.

## Deliverable

Persist project/site associations on Node and make sidebar suggestions predictable without moving an
explicitly selected conversation.

## Starting point and owners

- `packages/protocol/src/transport/api/projects.ts` defines project configuration contracts.
- `packages/node-core/src/server/projects/projectConfig.ts` and
  `packages/node-core/src/server/routes/projects/projects.ts` own config read/write behavior.
- `packages/node-core/src/server/db/schema.ts` owns persisted project data. Read [project
  configuration](../../workspaces-and-tasks/project-config.md).

## Implementation steps

1. Add an additive project configuration field for a bounded list of exact HTTP/HTTPS origins and
   optional path prefixes. Default the prefix to `/`; validate credentials, malformed origins, and
   unsupported schemes. Follow normal project change invalidation.

2. Add persistence and a migration only where the project model needs it. Treat absent settings as
   an empty list. Keep them out of committed repo config and preserve unrelated configuration
   fields.

3. Expose narrow native reads/writes and a sidebar editor for adding/removing associations. Display
   association scope separately from browser permission controls.

4. Match cached associations locally against the active site. Combine explicit settings with
   reliable provider/repository suggestions. Show a picker for ambiguity and for unmatched sites.

5. Let the person override the suggestion. Remember that override locally by node and site. Preserve
   an explicitly selected task/session across navigation, and display the changed page relationship
   instead of silently switching it.

6. Handle overlapping path prefixes and several project matches without precedence tricks: they are
   multiple candidates. The association is a suggestion, not a security grant or hard project
   restriction.

7. Offer per-site enable/revoke controls for persistent browser access. On revocation, remove
   injected controls and matching delivery immediately, including controls already injected into an
   open page.

## Demo and acceptance

Associate two different paths on one domain with two projects, then test an overlapping association
and an explicit override. Visit a localhost development URL and confirm the selected conversation
remains bound.

- Verify config round trips, missing settings, migrations, and preservation of unrelated project
  fields.
- Exercise exact origins, ports, path prefixes, localhost, malformed/credential-bearing URLs, and
  several matches.
- Switch nodes/projects/tabs during reads; reject stale settings and keep unsent drafts in their
  original scope.
- Revoke access with an open page; remove its controls without silently requesting broader access.

## Verify and complete

Run project config/routes and migration checks, extension scope tests, affected consumer suites,
lint, and architecture checks. Verify settings follow Node across both browser clients after
independent pairing.

Complete only when the deliverable and acceptance are demonstrated. Record any failure or
real-browser
verification gap; a build or mocked API alone does not prove browser behavior. Update the owning
reference docs for shipped contracts and add new documentation to both indexes where applicable.

## Scope and stop conditions

Stop at associations, suggestions, and an explicit override. Do not build a rule language, hard
project isolation, repo-config inheritance, or shared browser permission grants.

## Verify before building

- Recheck the live owners against the context baseline; prerequisite phases may have moved
  contracts.
- Use the repository's supported runtime, contribution boundaries, and focused test workflow.
- Resolve a prerequisite or contract conflict before adding another implementation path.

## Decisions made while building

The plan was silent or the code disagreed in these places:

- Associations are one more machine-local field on the project row, `site_associations`, a JSON list
  like `run_targets`. They travel as `siteAssociations` in the existing config read and in the
  existing `PUT /v1/core/projects/:id/config` patch, which replaces the whole list. That needed one
  additive migration, `0008_project_site_associations`, in core's chain only. A separate table would
  have needed its own routes for a list nobody queries by row.
- The shared rules live in `@acorn/protocol/siteAssociations.ts`: parsing what the person types,
  the canonical form the Node accepts, and matching. The Node, the host, and the sidebar use the same
  code, so an address one accepts the others read the same way.
- `core.projects.config` leaves associations out. They only steer the extension, and the published
  plugin types would otherwise grow a field no plugin needs.
- The Node has no list of associations across projects, and adding a collection route would be a
  second way to read the same setting. `sites.list` reads each project's config through the existing
  route. A Node has tens of projects, and the read happens on selection and on `project:changed`, not
  per page.
- Writes are `site.add` and `site.remove`, which read the project's list fresh and write it back. A
  whole-list write from the sidebar would drop a change another client made since its last read.
- The host sends a new `projects` event on `project:changed`, the Node's existing invalidation, and
  the sidebar reads the list again.
- Matching runs in the sidebar against the page address it already reads for handoff offers. That
  reader moved out of the site list into `activePageUrl`, so both use one. Nothing goes to the Node
  for matching. Phase 09 needs the list in the background, which keeps none today.
- One candidate is chosen. Several are listed first in the picker, and a project they leave out is
  cleared. No candidate changes nothing, because an unmatched page carries no information, and the
  plan asks for no global default. The picker follows the page only while no task is chosen; a chosen
  task shows a notice with **Switch to** instead.
- An override is keyed by the page's origin and the set of projects the page suggested. Keyed by
  origin alone, an override on `/app` would also win on `/docs`, which is suggested to a different
  project. Choosing the suggestion again forgets it, and choosing no project is remembered too.
- The host widens a handoff item's projects with the projects whose associations cover the page,
  except for an item carrying a pull number, which names a pull request only in its own repository.
  On create it reads the chosen project's associations again, so the sidebar can't widen the list.
  This covers phase 04's note about items with no mapped project: Linear and Rollbar items get a
  project from a site association, and a GitHub pull request in a repository with no folder still
  doesn't.
- Access patterns for associations drop the port. Firefox's match patterns can't name one, so
  `http://localhost:5173` asks for `http://localhost/*`. The association still matches only its own
  port.
- The site list now says what each site's access is for: buttons on its pages, handoffs in the
  sidebar, or project suggestions. That fixes the "Buttons show on linear.app" wording phases 05 and
  06 left. The card is now `SiteAccess`.
- No editor in the desktop or the terminal. Only the extension reads associations, and the desktop's
  project settings page sends partial patches, so it can't clear them. The CLI's
  `acorn project config set` doesn't take them either; nothing asked for it.
- Overlapping prefixes are all candidates, with no longest-prefix rule, as the plan says.

## Real-browser results

October 13, 2026, with Chrome 155.0.8059.40 and Firefox 151.0.3 on macOS. Chrome session `p07-chrome`
ran through `pnpm dev:extension`. Firefox went straight to the WebDriver BiDi route, because web-ext's
read of Firefox's `profiles.ini` is denied in the agent sandbox: session `p07-firefox-bidi`, the
development build, the host registered with `acorn browser install --development`, Firefox started
with `open`, the extension installed over BiDi, and the Node of `p07-chrome`, paired separately.

A second paired device added three plain-folder projects, `web`, `docs`, and `all`. The pages were
`example.com`, which draws a page for any path, and a local `python3 -m http.server` on
`localhost:5173`. Chrome's toolbar click ran through CDP's `Extensions.triggerAction`, which grants
`activeTab`, and the page moved with CDP's `Page.navigate`. Firefox's grants, removals, and the
sidebar's opening came from BiDi pointer input. The handoff check used a scratch loaded plugin on
`https://example.com/items/{id}` whose item names no project and carries no pull number.

| Check | Chrome | Firefox |
| --- | --- | --- |
| Add `https://example.com/app` to `web` and `https://example.com/docs/` to `docs` in the panel; the Node stores `/app` and `/docs` | Passed | n/a |
| `/app/login` chooses `web`; `/docs/intro` chooses `docs`; `/app/settings` chooses `web` again | Passed | n/a |
| Overlap: `all` on the whole of `example.com`; `/app` lists `web` and `all`; `/docs` lists `docs` and `all` and clears `web`, asking for a choice | Passed | Passed (`/items/9` suggests only `all`) |
| Override: choosing `docs` on `/app` is remembered for `example.com` and `web`; choosing `web` again forgets it; an override on `/docs` doesn't apply on `/app` | Passed | Not repeated |
| Add `http://localhost:5173/shop` and `/admin/` by typing; the access list shows `http://localhost` for project suggestions | Passed | Passed |
| A conversation chosen on `localhost:5173/shop/` stays bound on `/admin/`, with "This page suggests docs. The conversation stays in web." | Passed | Passed |
| **Switch to docs** clears the task; the unsent draft stays under its own conversation and comes back with it | Passed | Not repeated |
| A Firefox paired on its own shows the associations Chrome made, `web`'s included | n/a | Passed |
| Handoff of an item with no provider project offers `all` from the site association; **Create linked task** makes the task in `all` | Passed | Not repeated |
| Grant `example.com` from **Allow**; the panel suggests for the page and the page gets its button | Gap | Passed |
| Remove `example.com` with the page open: its button goes, the suggestion and the offer go, and no access remains | Gap | Passed |
| Stop the session, development registrations removed | Passed | Removed by `acorn browser uninstall` |

These gaps remain:

- Chrome's site grant and its removal, because Chrome's permission prompt can't be answered by a
  driver. Chrome's checks used the toolbar button's `activeTab`, which lasts while the tab stays on
  one site. Firefox covered both.
- A switch from one paired Node to another during a read wasn't made in a browser. Unit tests cover a
  late `sites.list` reply after a switch, and the host refuses an unselected Node.
- Two clients changing one project's associations at the same moment can still lose one change.
  `site.add` and `site.remove` read fresh before writing, which narrows that to the time between the
  read and the write. Unit tests cover a change made by another client between two writes.
- In Firefox the panel was opened from a button injected into the sidebar tab, because a driver can't
  click the toolbar and a page button can't open the sidebar.
- Firefox's first native port after start stalled again: the sidebar tab showed "The bridge did not
  answer" until it was reloaded, as in phase 04.
- Firefox reload on save and session stop through `pnpm dev:extension`, for the sandbox reason above.
