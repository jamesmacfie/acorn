# Phase 04: browser contributions and GitHub handoff

Status: implemented October 13, 2026, with the real-browser gaps listed in
[real-browser results](#real-browser-results). [Browser handoffs](../../plugin-authoring/browser-handoffs.md)
owns the contribution contract and [handoffs in the browser extension](../../browser-extension/handoffs.md)
the extension's side.

Read the [extension context](./README.md) before implementing this phase. It owns the release
boundary, authority model, shared contracts, and defaults.

## Prerequisites

[Page capture](./03-page-capture.md).

## Deliverable

Prove the public browser contribution contract with an in-page GitHub pull request button and a task
handoff.

## Starting point and owners

- `packages/protocol/src/plugin/contract.ts` and
  `packages/node-core/src/server/plugins/manifestValidation/node.ts` own declarations and route
  confinement.
- `packages/node-core/src/server/pluginHost/types.ts` and `plugins/github/src/node/index.ts` are the
  compiled contributor precedent.
- `plugins/github/src/client/contentLinks.ts` identifies repository/task relationships. Provider
  resolution belongs in the Node half.
- `packages/node-core/src/server/routes/projects/tasks.ts` owns task creation and connection-stamped
  links.

## Implementation steps

1. Add a bounded browser contribution descriptor for URL patterns, label, insertion anchor, and
   provider-owned resolution/context routes. Validate the descriptor using the shared URL grammar,
   own-plugin route rules, and contribution ID/size limits.

2. Advertise active loaded descriptors and equivalent compiled declarations. Use a core-owned
   generic discovery seam, with no provider names in core. Do not advertise an installed replacement
   before it becomes active.

3. Add native discovery and handoff operations that invoke only validated declared routes. Validate
   provider results before turning them into task seeds or draft context. Add a small loaded-plugin
   fixture to prove the contract is public.

4. Insert an extension-owned button in permitted GitHub pull request pages. Keep one control per
   contribution through client-side navigation and rerenders. Never interpolate page/plugin data
   into executable HTML, styles, or code.

5. Resolve the pull request in the GitHub Node plugin. Preserve repository, pull number, connection
   identity, title, and proposed context. Use authenticated provider operations rather than scraping
   the page.

6. Show already-linked tasks first and offer a picker if several match. Offer existing-task
   selection or linked task creation in the matching repository project. Keep a pull number out of
   an unrelated repository's task.

7. Open the selected task conversation. If none exists, retain the proposed context while the person
   starts a chat. Add context to the draft for review; a site button never sends it automatically.

8. Keep the same handoff action available in the sidebar when no DOM anchor is found. Clear controls
   when a contribution disappears, the node switches, or site access is removed.

## Demo and acceptance

Grant access on GitHub, click a pull request button, choose an existing task, and review its context
draft. On another pull request, create a linked task and start its conversation.

- Reject foreign routes, invalid patterns, duplicate IDs, oversized results, and inactive manifest
  declarations.
- Prove a loaded test plugin can declare a button and handoff without downloading browser code.
- Exercise duplicate prevention, client-side navigation, missing anchors, node switches, and
  permission removal.
- Verify case-insensitive repository identity, linked-task suggestions, repeated submission,
  unavailable credentials, and wrong-repository creation refusal.

## Verify and complete

Run manifest, plugin roster/discovery, task route, GitHub provider, and extension suites. Run lint
and architecture checks. Verify insertion and sidebar fallback on a real GitHub pull request.

Complete only when the deliverable and acceptance are demonstrated. Record any failure or
real-browser
verification gap; a build or mocked API alone does not prove browser behavior. Update the owning
reference docs for shipped contracts and add new documentation to both indexes where applicable.

## Scope and stop conditions

Stop once GitHub and the public declaration fixture work. Do not implement a general Node action
runner, website automation, or remote plugin browser bundles.

## Verify before building

- Recheck the live owners against the context baseline; prerequisite phases may have moved
  contracts.
- Use the repository's supported runtime, contribution boundaries, and focused test workflow.
- Resolve a prerequisite or contract conflict before adding another implementation path.

## Decisions made while building

The plan was silent or the code disagreed in these places:

- The contribution kind is `browserHandoffs`. Its protocol module is `plugin/handoffs.ts`, because a
  protocol file named for `browser` reads as named for the browser plugin to the boundary rule. No
  plugin ID was added to the boundary allowlist.
- One route per handoff, `resolve`, answers identity, projects, the seed, and the proposed context
  together. A second context route would cost another round trip for nothing the first can't carry.
- Compiled plugins declare `NodePlugin.browserHandoffs`, the precedent `emits` set. The host records
  both tiers' declarations through one validator when it binds a plugin, and drops them with the
  plugin's other registrations, so discovery lists only running plugins. A package waiting for review
  or a restart has no binding, which answers "don't advertise an installed replacement".
- The extension's native host, not core, finds linked tasks and builds the create. It reads the Node's
  own task list: a seed link names a task in any project, a pull number only in one of the item's
  projects. `handoff.create` resolves the page again and takes the seed from that answer, so the
  browser names only the item, its connection, and the project. Core gained only the discovery route.
- A GitHub pull request is recorded on the task row as `pullNumber`, not as a task link, so GitHub's
  seed carries the number and head branch and no link. Its resolver reads once per connection with
  that connection's credential through `withConnections`, so two accounts are two items.
- GitHub needs every clone of a repository as a choice. `core.projects.byGithub` answers only the
  oldest, so the resolver reads each checkout's facet. A GitHub project with no folder on disk isn't
  suggested.
- The content-link grammar now ignores one trailing slash on an address, everywhere it is used, as
  the programme asks for providers' canonical forms. Exact arity stays, so GitHub declares
  `/pull/{number}` and `/pull/{number}/{tab}`.
- Items with no project can't be created from the card. **Choose another task** covers them, and
  phase 07's associations can widen `projects`.
- The proposed context waits in the sidebar until the person opens a conversation, then joins that
  conversation's stored draft through `changeDraft` before the composer mounts. Opening a linked or new
  task picks its newest conversation, or shows the new-chat picker.
- Buttons are drawn from a list the background keeps in `storage.local`, so a page gets its buttons
  without starting the native host. Pages are matched in the browser; an address goes to the Node only
  on a handoff.
- The content script skips anchors that aren't drawn. GitHub hides its header's action row
  (`PH_Actions`) at both window widths tried, so GitHub's anchors list that row, then the state line
  under the title.
- The sidebar re-reads the active tab after a toolbar click, which grants access without any tab
  event, and after a grant changes.

## Real-browser results

October 13, 2026, with Chrome 155.0.8059.40 and Firefox 151.0.3 on macOS. Chrome session `p04-chrome`
ran through `pnpm dev:extension`. Firefox through `pnpm dev:extension` (`p04-firefox`) failed as in
phases 01 to 03: web-ext's read of `~/Library/Application Support/Firefox/profiles.ini` is denied in the
agent sandbox (EPERM). The Firefox checks ran in `p04-firefox-bidi`: the development build, the host
registered with `acorn browser install --development`, Firefox started with `open`, the extension
installed over BiDi, and the Node of `p04-chrome`.

The pull requests were jamesmacfie/acorn #39, a public pull request, on github.com. The Node had no
GitHub connection (see gaps). The rest of the flow used a loaded fixture plugin installed into the
session's Node: `https://example.com/items/{id}`, anchored on `body`, suggesting only a plain-folder
project, with the item number as the task's pull number. Chrome's toolbar click ran through CDP's
`Extensions.triggerAction`; page clicks were trusted input from CDP and BiDi.

| Check | Chrome | Firefox |
| --- | --- | --- |
| Discovery lists GitHub's compiled handoff and the loaded fixture's, with their sites | Passed | Passed |
| An installed fixture waiting for a restart isn't listed; after the restart it is | Passed (Node) | Not repeated |
| No access: a matching page gets no button | Passed | Passed |
| Toolbar click: the PR page gets one button in its visible header row | Passed | Gap |
| Site grant: an open PR page gets its button without a reload | Gap | Passed |
| Trusted click on the button opens the panel with the handoff | Passed | Handoff reached the open sidebar page; the sidebar didn't open |
| GitHub resolve with no connection shows "Connect GitHub" | Passed | Passed |
| Client-side move to the commits tab keeps one button; leaving the PR removes it; returning restores it | Passed | Not repeated |
| `PH_Actions` hidden: the button goes in the next anchor; the sidebar offers the handoff for the page | Passed | Passed |
| Fixture: resolve, create a linked task, start a chat; the draft holds the item, nothing is sent | Passed | Passed |
| Fixture: hand off again, the linked task is listed first; **Open** reaches its conversation, one capture | Passed | Not repeated |
| Fixture: **Create linked task** again answers the existing task | Passed | Not repeated |
| Fixture: **Choose another task**, pick an existing task; its draft gets the item, the task gains no link | Passed | Not repeated |
| Forget the selected Node: buttons leave open pages | Passed | Not repeated |
| Remove the site grant: the open page's button and the sidebar's offer go | Gap | Passed |
| Stop the session, development registrations removed | Passed | Removed by `acorn browser uninstall` |

These gaps remain:

- A real GitHub resolution, creation from a pull request, and the pull request's context draft. The
  session's Node had no GitHub connection. GitHub connects only by device flow, which needs a person,
  and sealing the local `gh` token into the test Node was refused by the agent's permission
  classifier. Unit tests cover the resolver; the fixture covered the same host and sidebar path.
- Chrome's site grant and its removal, because Chrome's permission prompt can't be answered by a
  driver. Firefox covered both.
- In Firefox a page button can't open the sidebar. The handoff waits for the next sidebar, which the
  extension can't open for the person.
- A switch from one paired Node to another wasn't made in a browser; forgetting the selected Node was.
  Unit tests cover a switch.
- Firefox's first native port after start stalled again. The 10-second deadline ended it, but the
  sidebar tab already open kept showing "The bridge did not answer" through two more tries, with no
  host process started, until the tab was reloaded. A port opened from the page or the background by
  hand answered at once. The cause is unknown and may predate this phase.
- Firefox reload on save and session stop through `pnpm dev:extension`, for the sandbox reason above.

