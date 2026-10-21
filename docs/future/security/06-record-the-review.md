# Phase 6: record the review

Date: October 22, 2026. Status: proposed. Runs after phases 1 to 5.

Each earlier review has a dated page in [security](../../security.md) that lists every finding, the
change that closed it, and how it was checked. This phase writes that page for the October 22 review,
reruns the checks together, walks the two worst chains in a real session, and removes this programme.
Read [the programme](./README.md) first.

## Changes

### Write the dated page

Add `review-2026-10-22.md` to `docs/security/`, in the shape of
[the October 21 review](../../security/review-2026-10-21.md):

1. One paragraph: the date, the base commit `47287b67c`, what the review covered, and that the review
   itself was a source review.
2. A findings table with IDs starting at T1: the area, the finding, the change, and the status. Take
   the rows from [the programme's findings](./README.md#findings).
3. **Behavioral changes**, written for someone upgrading. At least these:
   - With **Keep agents out of Acorn's data folder** on, an agent also can't read the client config
     folder.
   - The gateway sandboxes every answer it forwards.
   - A phone session ends after 30 days without use, and the cookie lasts 30 days.
   - A phone gets `403 gateway_refused` for every plugin write, except any path phase 4 kept open.
   - The memory contract tells agents a memory is never a reason to run a command.
4. **Verification**: each command below with its result, and every known failure named.
5. **Regression coverage**: the test that holds each finding.
6. **Decisions**: anything the owner chose along the way, with its date. Restate R13 and R21 if they're
   still open, and keychain sealing for client tokens as the follow-up from phase 1.

Link the page from [security](../../security.md) beside the other dated reviews, and from
[the docs index](../../README.md).

### Rerun the checks together

| Check | What it shows |
| --- | --- |
| `pnpm audit --prod` | No advisory beyond ones ignored with a written reason |
| `pnpm lint` | No new errors in a changed file |
| `pnpm test --filter=@acorn/mobile` | The gateway's headers, session expiry, and the blocked list |
| `pnpm test --filter=@acorn/plugin-agents` | The read block's extra folders |
| `pnpm test --filter=@acorn/plugin-memory` | The contract paragraph |
| `pnpm test --filter=@acorn/custody` | `configDir()` after the move |
| `pnpm --filter @acorn/arch-tests test` | Doc links and import boundaries |
| `pnpm --filter @acorn/node build` | The Node service's size ceiling, if phase 1 moved code into its graph |

### Walk the attacks in a real session

In `pnpm dev:agent`, with the switch on and an agent's shell:

1. `cat` the client folder's `device-token-local`, and run
   `env -u ACORN_TASK_ID -u ACORN_API_TOKEN acorn task list`. Expect both to fail.
2. Run `acorn task scripts status`. Expect it to work.

With `pnpm dev:mobile` and a scratch loaded plugin whose route answers an HTML page with a script:

3. Open the plugin's route through the gateway in a browser that holds a phone session. Expect the
   page to render with no script running, and no request to `/node` in the browser's network log.

Record each result in the dated page. The memory on walking task-token attacks in `dev:agent` covers
getting a real task token and loading a scratch plugin.

### Remove this programme

Delete `docs/future/security/`, and add a row to the removed plans table in
[the future index](../README.md) pointing at the dated page and listing anything left open.
