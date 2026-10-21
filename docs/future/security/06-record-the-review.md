# Phase 6: record the review

Date: October 21, 2026. Status: proposed. Runs after phases 1 to 5.

Each earlier review has a dated page in [security](../../security.md) that lists every finding, the
change that closed it, and how it was checked. This phase writes that page for the October 21 review,
reruns the checks together, and removes this programme. Read [the programme](./README.md) first.

## Changes

### Write the dated page

Add `review-2026-10-21.md` to `docs/security/`, in the shape of
[the October 11 review](../../security/review-2026-10-11.md):

1. One paragraph: the date, the base commit `32b2ab6c3`, what the review covered, and that it was a
   source review with no live attack run against a Node, if that's still true by then.
2. A findings table with an ID per finding, starting at S1: the area, the finding, the change, and
   the status. Take the rows from [the programme's findings](./README.md#findings). A finding that
   phase 4's check closed without a code change says "No change needed" and names the test.
3. **Behavioral changes**, written for someone upgrading. At least these:
   - A task token gets 404 from a loaded plugin's tool, context, CLI command, data source, schedule,
     task check, and hook paths over HTTP.
   - A second pairing ask inside two minutes cancels both, and the ask has its own ceiling of 6 a
     minute.
   - A task token creates tasks only in its own project, stored with `origin` set to `agent`.
   - A record-triggered agent step in an unguarded mode stops at **Needs review** unless its trigger
     allows it.
4. **Verification**: each command below with its result, and every known failure named, as the
   October 11 page does.
5. **Regression coverage**: the test that holds each finding.
6. **Decisions**: anything the owner chose along the way, with its date, and R13 and R21 restated as
   still open if they are.

Link the page from [security](../../security.md) beside the other dated reviews, and from
[the docs index](../../README.md).

### Rerun the checks together

Use the Node version the plugin worker suites need. The shell's default Node may be older than the
loaded-plugin floor, and those suites fail on it.

| Check | What it shows |
| --- | --- |
| `pnpm audit --prod` | No advisory beyond ones ignored with a written reason |
| `pnpm lint` | No new errors in a changed file |
| `pnpm test --filter=@acorn/node-core` | Mount coverage, the fetch route, pairing, and task routes |
| `pnpm test --filter=@acorn/node` | Plugin mount coverage, with the loaded plugin cases from phase 1 |
| `pnpm test --filter=@acorn/client-core` | The pairing dialog |
| `pnpm test` for agents, workflows, and docker | The unguarded refusal, trigger review, and Docker gates |
| `pnpm --filter @acorn/arch-tests test` | Doc links and the override lists |
| `pnpm pack:node` | The Node service's size ceiling |

### Walk the attacks once in a real session

In `pnpm dev:agent`, from a shell holding an agent's task token:

1. Post to a loaded plugin's CLI command route and its tool handler. Expect 404.
2. Send pairing asks every three seconds while the owner pairs the terminal client. Expect the dialog
   to close and the owner's next ask to pair.
3. Create a task in another project. Expect 403.

Record each result in the dated page.

### Remove this programme

Delete `docs/future/security/`, and add a row to the removed plans table in
[the future index](../README.md) pointing at the dated page and listing anything left open.
