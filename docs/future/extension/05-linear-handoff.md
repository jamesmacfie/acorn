# Phase 05: Linear handoff

Status: implemented October 13, 2026, with the real-browser gaps listed in
[real-browser results](#real-browser-results). [Linear](../../integrations/linear.md#browser-handoff)
owns the route, and [browser handoffs](../../plugin-authoring/browser-handoffs.md) the contract.

Read the [extension context](./README.md) before implementing this phase. It owns the release
boundary, authority model, shared contracts, and defaults.

## Prerequisites

[Browser contributions and GitHub handoff](./04-github-handoff.md). Can proceed independently of
phases 06-08.

## Deliverable

Use the same browser contribution contract to bring a Linear issue into a task conversation with the
correct provider connection.

## Starting point and owners

- `plugins/linear/acorn-plugin.config.mjs` owns loaded declarations and the short/slug URL
  precedent.
- `plugins/linear/src/server/routes/linear.ts` and `plugins/linear/src/server/provider.ts` own issue
  resolution.
- `plugins/linear/src/shared/issueSource.ts` supplies provider-owned task promotion data.

## Implementation steps

1. Declare the issue control and its own Node resolution/context routes in the Linear manifest.
   Handle both short URLs and the issue-title slug form through the shared matcher.

2. Resolve issue identity against connected Linear accounts. Compare the website workspace and
   canonical issue identity, not only the team-prefix identifier. Return all valid connection-bound
   candidates; do not copy the bare-identifier route's first-answer behavior.

3. Use existing external-project mappings to suggest Acorn projects when the provider can establish
   the issue's project/team relationship. Preserve ambiguity rather than guessing from a workspace
   slug.

4. Reuse the shared existing-task and task-promotion flow. Include the connection-bound external
   reference and provider promotion seed; do not create another task endpoint.

5. Supply issue context through the provider route and place it in the draft. Keep chosen-task
   selection separate from silently writing a persistent issue link.

6. Handle an inaccessible/deleted issue, expired credentials, rate limits, multiple candidates, and
   missing DOM anchors with the shared sidebar fallback.

## Demo and acceptance

Hand off short and slug URLs. Use a fixture or test account setup with colliding team prefixes in
two connections and select the correct candidate explicitly.

- Resolve canonical workspace plus identifier, including two connections with the same identifier.
- Verify project/team mapping suggestions, exact existing links, and correct task promotion
  identity.
- Exercise unavailable credentials, deleted issues, rate limits, navigation changes, and missing
  anchors.

## Verify and complete

Run Linear route/provider tests, shared handoff tests, manifest checks, lint, and architecture
checks. Demonstrate a real issue handoff in both browsers.

Complete only when the deliverable and acceptance are demonstrated. Record any failure or
real-browser
verification gap; a build or mocked API alone does not prove browser behavior. Update the owning
reference docs for shipped contracts and add new documentation to both indexes where applicable.

## Scope and stop conditions

Stop at issue handoff and context capture. Do not change the rest of Linear's bare-identifier
navigation, comments, or mutation APIs as part of this phase.

## Verify before building

- Recheck the live owners against the context baseline; prerequisite phases may have moved
  contracts.
- Use the repository's supported runtime, contribution boundaries, and focused test workflow.
- Resolve a prerequisite or contract conflict before adding another implementation path.

## Decisions made while building

The plan was silent or the code disagreed in these places:

- The contract needed no change. Linear's handoff is a manifest declaration and one resolve route, as
  phase 04 set up. The plan's "resolution/context routes" are the one `resolve` route.
- The route must sit in Linear's provider router (`createLinearRoutes`), not on a `ctx.routes.fetch`
  mount. A loaded provider's fetch router is mounted over all of `/v1/p/linear` and answers 404 for
  any path it doesn't know, so core's dispatch for other loaded mounts is never reached over HTTP. The
  first real-browser try failed this way. Linear's existing `/data/issues` mount has the same shape,
  but data sources call it through an internal dispatch, so nothing noticed. The contract doc warns
  plugin authors. A core change that falls through on a provider 404 would remove the trap, but it
  touches every provider route, so it's left for its own change.
- No anchors. Linear's issue page needs a signed-in session, its class names are generated, and
  there was no account here to check a selector against. The extension offers the handoff in the
  sidebar, which the programme already requires for a page with no anchor.
- Identity is the page's workspace plus the identifier, checked against Linear's own `url` for the
  issue. Every connection that isn't disabled is asked, in parallel, through the `linear.issues`
  resource with `force` and `requireFresh`. The resource adds the cache, budget, and secret scope, and
  `requireFresh` keeps a deleted issue or a rejected key from being answered out of the cache.
- Projects come from the workspace mappings, matched on the issue's Linear project or `team:<id>` on
  the same connection, with a whole-workspace mapping covering each checkout in that workspace. The
  detail query gained the team's `id` for this. Nothing is guessed from the address's workspace key.
- The seed reuses the rail's promotion fields (`linearTaskFields`, shared with the rail row) and adds
  the issue as one connection-stamped link, the same link the rail's **+Task** writes. The host's
  linked-task search finds it in any project.
- A rejected or expired key answers 403, never 401: the host reads a 401 as the Node refusing the
  browser and tells the person to pair again.
- Linear reports a rate limit as HTTP 400 with `RATELIMITED` in the body. `linearRateLimited` reads it,
  and the `linear.issues` resource reports `provider_rate_limited` (429) instead of "unavailable".
  The handoff prefers a reconnect message, then the rate limit, then "unavailable", and answers the
  workspaces that did answer when another failed.
- The sidebar read the page again only on a tab update that carried `url`. Chrome leaves `url` out
  once the tab leaves the site a toolbar click granted, so the offer stayed on the old Linear page.
  It now also reads on `status: 'complete'`, as the background already did. GitHub hid this, because
  the background clears its in-page button.

## Real-browser results

October 13, 2026, with Chrome 155.0.8059.40 and Firefox 151.0.3 on macOS. Chrome session `p05-chrome`
ran through `pnpm dev:extension`. Firefox went straight to the WebDriver BiDi route, because web-ext's
read of Firefox's `profiles.ini` is denied in the agent sandbox: session `p05-firefox-bidi`, the
development build, the host registered with `acorn browser install --development`, Firefox started
with `open`, the extension installed over BiDi, and the Node of `p05-chrome`.

Linear was built into the session's Node with `build:plugin linear`, because the dev Node doesn't
install loaded packages. The pages were `linear.app/acorn-check/issue/ENG-42` and its slug form,
signed out. Linear keeps the issue address and adds `?noRedirect=1`, which the matcher ignores. The
Node had no real Linear key (see gaps). A fake key, sealed into an `integrations` row with the Node's
own `encryptSecret`, reached Linear and was refused. Chrome's toolbar click ran through CDP's
`Extensions.triggerAction`; Firefox's sidebar and site grant came from BiDi pointer input.

| Check | Chrome | Firefox |
| --- | --- | --- |
| Discovery lists Linear's handoff, with both addresses and no anchors, after a restart | Passed | Passed |
| The panel offers **Open in Acorn** for a Linear issue page (toolbar click in Chrome, site grant in Firefox) | Passed | Passed |
| Short address, no Linear connection: "Connect Linear in Acorn…" | Passed | Not repeated |
| Slug address, fake key refused by Linear: "Linear didn't accept the saved key…", not a re-pair | Passed | Passed |
| Connection marked needs-auth: the same reconnect message | Passed | Not repeated |
| Connection disabled: "Connect Linear in Acorn…" | Passed | Passed |
| The short address is offered as well as the slug | Passed | Passed |
| The tab leaves Linear: the offer goes; an open card stays until dismissed | Passed, after the fix above | Passed |
| Firefox's first native port after start | n/a | Answered at once; the stall wasn't seen |
| Stop the session, development registrations removed | Passed | Removed by `acorn browser uninstall` |

These gaps remain:

- A real Linear resolution, the issue's context draft, and task creation from it. Only a fake key
  was available, and copying the person's real credentials into a test Node was out of bounds. The
  route's resolution, the two-workspace collision, project mappings, the seed, the context, deleted
  issues, and rate limits are covered by `plugins/linear/src/server/browserHandoff.test.ts`, the
  router test in `routes/linear.test.ts`, and three Node parity tests in
  `apps/node/test/integration/plugins/linear.test.ts` that run the real resource runtime against
  mocked Linear answers. Phase 04's fixture plugin already proved the host's create, linked-task, and
  draft path in both browsers. Linear's seed goes through that same path.
- Two real connections with colliding team keys were checked only in tests, for the reason above.
- A rate limit from Linear's API wasn't produced in a browser.
- No in-page button, by design (see decisions). A selector needs a signed-in Linear page to check.
- The site list says "Buttons show on linear.app" after a grant, though Linear draws no button.
  Phase 07, which owns site settings, is the place to word it for sidebar-only handoffs.
- Chrome's site grant can't be answered by a driver, and in Firefox a page button can't open the
  sidebar. Neither matters much for Linear, which has no page button, but both stand from phase 04.

