# 10-11. Linear shows the last issue while the next one loads

**Status:** not started. Batch B10a. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

When you pick another Linear issue, the detail keeps the previous issue while it waits, and nothing
marks the wait. For as long as Linear takes, the list and the detail disagree, and a comment typed in
that gap posts to the newly selected issue. When a load or a refresh fails, the whole issue is replaced
by a banner. Rollbar does the opposite on both counts, which is what `docs/integrations.md` promises.

## Where to see it

Linear with the area 10 seed. Use the `nodeFetch` patch's delay to slow the issue route, then switch
from ACO-42 to ACO-51. Use its error code to fail a refresh.

## The fix

In `plugins/linear/src/tree/app.tsx:57-78, 98-106`, copy Rollbar's `keepView`
(`plugins/rollbar/src/tree/app.tsx:48-84`):

- On a new target, clear the issue before the fetch.
- On a failed refresh of the same issue, keep it and show a banner above it.

## Copy

No copy rows. The banner's words are [10-12](./10-12-states.md)'s.

## Risk and checks

- Before you start, read Rollbar's `keepView` and confirm it still behaves as described.
- Switch issues quickly and type a comment in the gap. It must not post to the wrong issue.
- Screens: switching, a failed load, and a failed refresh.
- Tests: `plugins/linear`.
