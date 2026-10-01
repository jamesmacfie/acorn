# 11-4. Deleting a saved request or variable says it failed, and the row stays

**Status:** not started. Batch B11. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

The http plugin's delete routes answer `204 No Content`. The plugin carrier rebuilds the worker's
response as `new Response(bodyBuffer(body), { status: 204 })`, and the runtime refuses any body on a 204.
The node answers 500 after the row is already deleted. The pane prints "DELETE failed with 500" in red
and the row stays until a reload. The person sees an error for an action that worked, tries again, and
gets "not_found".

## Where to see it

API pane › save a request, then delete it; or the Variables view › add a variable, then delete it.
`logs/desktop.log` shows "Response constructor: Invalid response status code 204".

## The fix

- `packages/node-core/src/server/plugins/pluginRpc.ts:179`: `new Response(BODILESS.has(status) ? null :
  bodyBuffer(body), …)` with the set {204, 205, 304}. Share it with, or copy it from,
  `packages/node-core/src/server/middleware/idempotency.ts` (around `:10`), which already handles this.
- Add a plugin-RPC test for a 204 route, using the fixture
  `packages/node-core/src/server/plugins/__fixtures__/rpcWorker.ts`.

## Copy

No copy rows.

## Risk and checks

- Before you start, confirm `BODILESS` in the idempotency middleware is the same set.
- This changes the plugin carrier for every loaded plugin. Only http answers 204 today. Run the whole
  node-core suite.
- Restart the node to see the change.
- Screens: delete a saved request and a variable; both rows go, with no error.
- Tests: `packages/node-core` (the new plugin-RPC case), `plugins/http`.
