# Phase 06: Rollbar handoff

Status: implemented October 13, 2026, with the real-browser gaps listed in
[real-browser results](#real-browser-results). [Rollbar](../../integrations/rollbar.md#browser-handoff)
owns the route, and [browser handoffs](../../plugin-authoring/browser-handoffs.md) the contract.

Read the [extension context](./README.md) before implementing this phase. It owns the release
boundary, authority model, shared contracts, and defaults.

## Prerequisites

[Browser contributions and GitHub handoff](./04-github-handoff.md). Can proceed independently of
phases 05, 07, and 08.

## Deliverable

Resolve a Rollbar website item into its connection-bound task reference and continue investigation
in an agent conversation.

## Starting point and owners

- `plugins/rollbar/acorn-plugin.config.mjs` owns loaded declarations.
- `plugins/rollbar/src/server/routes/rollbar.ts`, `plugins/rollbar/src/server/provider.ts`, and
  `plugins/rollbar/src/server/index.ts` own provider resolution.
- `plugins/rollbar/src/server/normalize.ts` owns canonical item URLs and privacy-limited error data.

## Implementation steps

1. Declare the item button and plugin-owned Node resolution/context routes. Prove canonical
   `/item/<global-id>/` URLs first, including trailing slashes. Do not infer project counters from
   the URL number.

2. Resolve through authenticated Rollbar connections using the global item ID. Return the actual
   project counter, global ID, and resolving connection. Surface several valid candidates instead of
   selecting the first.

3. Suggest projects using connection/external-project mappings. Keep connection and item identity
   attached through exact-link lookup and task creation.

4. Reuse the handoff/promotion and draft flow from phase 04. Provide normalized error context
   appropriate for investigation, using the provider's allowlisted fields and limits.

5. Preserve credential, inaccessible-item, rate-limit, and partial-failure explanations. Do not pass
   raw occurrence bodies, cookies, headers, or crash-report payloads to the browser.

6. Verify the site insertion anchor and sidebar fallback against the real item view. Additional URL
   forms require fixture-backed provider identity resolution, not loose guessing.

## Demo and acceptance

Hand off a canonical item whose global ID differs from its project counter. Create or choose a task
and inspect the correct connection-bound link and proposed error context.

- Use distinct global IDs and project counters to catch identity substitution.
- Exercise multiple project connections, mapped project suggestions, and inaccessible/expired
  connections.
- Verify normalized context excludes disallowed occurrence fields and respects byte limits.
- Check trailing-slash matching, navigation changes, missing anchors, and sidebar fallback.

## Verify and complete

Run Rollbar normalization/provider/route tests, shared handoff tests, manifest checks, lint, and
architecture checks. Demonstrate a real item in both browsers.

Complete only when the deliverable and acceptance are demonstrated. Record any failure or
real-browser
verification gap; a build or mocked API alone does not prove browser behavior. Update the owning
reference docs for shipped contracts and add new documentation to both indexes where applicable.

## Scope and stop conditions

Stop at item handoff and normalized capture. Do not add error mutations, unrestricted occurrence
export, or a second Rollbar cache.

## Verify before building

- Recheck the live owners against the context baseline; prerequisite phases may have moved
  contracts.
- Use the repository's supported runtime, contribution boundaries, and focused test workflow.
- Resolve a prerequisite or contract conflict before adding another implementation path.

## Decisions made while building

The plan was silent or the code disagreed in these places:

- The contract needed no change. Rollbar's handoff is a manifest declaration and one `resolve` route,
  as for Linear. The plan's "resolution/context routes" are that one route.
- Only the permalink, `rollbar.com/item/<id>/`, is matched. It is the address the plugin already gives
  every item, and the only form that names the item by Rollbar's system id. Signed out, it redirects to
  Rollbar's login page. The address a signed-in item view settles on probably names an account,
  a project slug, and the counter. Nothing ties a slug to a connection, so that form is left out, as
  the plan asks.
- The item is read through the existing `rollbar.items` resource, with a new `{ kind: 'item', itemId }`
  input that asks Rollbar's `/item/<id>`. It shares the `detail` read's request, normalizer, and
  persistence, so the item lands in the one cache under the counter Rollbar answered with. The
  occurrence reads after it then find the system id there and make no counter lookup. The cache keys
  rows by counter, so the resource's `read` for this input looks through the connection's rows for the
  id. That is one connection's mirrored list plus the items someone opened. A direct fetch beside the
  resource, as rail search does, would have needed its own needs-auth, budget, and error handling.
- Every connection that isn't disabled is asked, with `force` and `requireFresh`, as Linear's handoff
  does. A connection counts only when Rollbar's id for the answer is the page's. Each one that counts
  is a separate item. One item normally means one connection, because a token reads only its own
  project.
- Projects come from the workspace's connection mappings, the rail's `scopedConnections` rule read the
  other way: a mapping of that connection covers its workspace, or only the project it names. A project
  with no folder on disk isn't offered.
- The seed shares `rollbarTaskFields` with the rail's **+Task**: origin, title, and the item as a
  connection-stamped link on its counter, with the system id and permalink in the reference. Rollbar
  suggests no branch, and the rail's dialog asks the person for one. The handoff card has no branch
  field, so a task created from it starts without a branch. Inventing one, such as `rollbar-142`, would
  have been a second rule the rail doesn't follow.
- The context is built from fields the normalizer already allows, read through the occurrence
  resources. The handoff also drops the person and a request's query string, and stops at 12,000
  bytes. The occurrence reads are soft, as for `issue_detail`.
- A rejected token answers 403, as Linear's does. Rollbar's resource reads a Rollbar 403 as a token to
  reconnect, which is right for a revoked token. If Rollbar answers 403 rather than 404 for another
  project's item, the handoff would ask for a reconnect. That couldn't be checked without real tokens
  for two projects.
- No anchors. The item view needs a signed-in Rollbar session, and none was available to check a
  selector against, so the extension offers the handoff in its sidebar.

## Real-browser results

October 13, 2026, with Chrome 155.0.8059.40 and Firefox 151.0.3 on macOS. Chrome session `p06-chrome`
ran through `pnpm dev:extension`. Firefox went straight to the WebDriver BiDi route, because web-ext's
read of Firefox's `profiles.ini` is denied in the agent sandbox: session `p06-firefox-bidi`, the
development build, the host registered with `acorn browser install --development`, Firefox started
with `open`, the extension installed over BiDi, and the Node of `p06-chrome`.

Rollbar was built into the session's Node with `build:plugin rollbar`. Signed out, Rollbar redirects
`rollbar.com/item/<id>/` to `app.rollbar.com/login/…`, so the tab never stays on the item. The checks
answered the item address with a stub page: CDP's `Fetch.fulfillRequest` in Chrome, BiDi's
`network.provideResponse` in Firefox. The extension saw the real address, and every resolve went
through the native host and the Node to Rollbar's real API. The Node had no real Rollbar token (see
gaps). Two connections, `web` mapped to the session's project and `api` unmapped, were sealed with
obviously fake tokens using the Node's own `encryptSecret`. Rollbar rejected both. Chrome's toolbar
click ran through CDP's `Extensions.triggerAction`. Firefox's site grant and sidebar came from BiDi
pointer input.

| Check | Chrome | Firefox |
| --- | --- | --- |
| Discovery lists Rollbar's handoff, with its address and no anchors, after a restart | Passed | Passed |
| The route answers over HTTP through the Node, not a 404 (from a second paired device) | Passed | n/a |
| The panel offers **Open in Acorn** for an item page (toolbar click in Chrome, site grant in Firefox) | Passed | Passed |
| No Rollbar connection: "Connect Rollbar in Acorn…" | Passed | Not repeated |
| Two fake tokens, both refused by Rollbar: "Rollbar didn't accept the saved token for Rollbar · web…", not a re-pair | Passed | Passed |
| One connection disabled, the other needs-auth: the reconnect message names the needs-auth one | Passed | Passed |
| Every connection disabled: "Connect Rollbar in Acorn…" | Passed | Passed |
| The address without its trailing slash is offered and resolved | Passed | Not repeated |
| The tab follows the real redirect to Rollbar's login: the offer goes, and an open card stays until dismissed | Passed | Passed |
| Stop the session, development registrations removed | Passed | Removed by `acorn browser uninstall` |

These gaps remain:

- A real Rollbar resolution, the item's context draft, and task creation from it. Only fake tokens
  were available, and copying the person's real credentials into a test Node was out of bounds. The
  route's resolution, distinct ids and counters, several connections, project mappings, the seed, the
  context's allowlist and byte limit, and the refusals are covered by
  `plugins/rollbar/src/server/browserHandoff.test.ts` and the router test in `routes/rollbar.test.ts`.
  Four Node parity tests in `apps/node/test/integration/plugins/rollbar.test.ts` run the real resource
  runtime against mocked Rollbar answers. They also check that the occurrence reads reuse the cached id.
  Phase 04's fixture plugin already proved the host's create, linked-task, and draft path in both
  browsers. Rollbar's seed goes through that same path.
- Rollbar's real item view. It needs a signed-in session, so its address after the permalink redirect,
  and any in-page anchor, weren't seen. The handoff is sidebar-only and matches only the permalink.
- Whether Rollbar answers 403 or 404 when a token asks for another project's item (see decisions).
- A rate limit from Rollbar's API wasn't produced in a browser.
- The site list says "Buttons show on rollbar.com" after a grant, though Rollbar draws no button, as
  for Linear. Phase 07, which owns site settings, is the place to word it.
- Chrome's site grant can't be answered by a driver, and in Firefox a page button can't open the
  sidebar. Rollbar has no page button, but both gaps stand from phase 04.
