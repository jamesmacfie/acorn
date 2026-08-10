# 07 — Manual verification pass over the linear-migration surfaces

**Goal.** Everything the migration could only prove by reading code gets watched working in the real
desktop app once, and ../linear.md § "Still owed" is updated to record what was seen. The repo's
vitest suites render no components (node environment, no Solid transform), so none of this is
covered by a green test run, and no new desktop e2e specs should be written (that suite is being
extracted from this repo).

## Prerequisites

- Rebuild `apps/desktop` first — several fixes are renderer code.
- Expect fresh trust prompts for linear and rollbar (rebuilt bundles, new hashes). Until accepted,
  they contribute no surfaces: a missing pane at boot is the prompt, not a regression.

## The checklist (from ../linear.md, kept there as the source of truth)

1. The reference panel over a ticket: from a GitHub PR body citing one (the highest-risk surface —
   inside a task it should open the panel, not swap the task's pane), and from classic browse.
2. The project-scoped issue view: a rail row click with no task open; pasting
   `/p/<id>/x/linear/issues/ENG-42`; the back button between two tickets; the iframe filling the
   two grid columns beside the rail list.
3. `ui.openUrl` on screen: a `github.com` link in a ticket description reaching the browser; an
   attachment title opening; a `linear.app` link re-pointing the frame in place rather than going
   over the port. Also the new gates: a link click works, and a second immediate click is throttled
   without breaking the first.
4. The workspace project-mapping picker: ticking a real project and the row landing; the
   failing-connection row.
5. Both appearance axes (theme × style) over the frame surfaces above.
6. A `linear.app` URL pasted into a note: pane in a task context, reference panel with none.
7. A real Linear token — every prior run was against a fake `api.linear.app`.

## Done when

Each item above is either checked off in ../linear.md's "Still owed" section (with anything broken
filed) or moved to a named follow-up. The point of the pass is to shrink that list to zero or to
known bugs.
