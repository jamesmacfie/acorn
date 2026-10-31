# What's left for review guide v2

Date: October 31, 2026. Status: built, and the work below is open. It replaces the
`docs/future/review-guide/` phases, which landed between October 30 and 31, 2026, and are in Git
history with their completion notes and the `ux-spike.html` mockup.

[The review guide plugin](../first-party-plugins/review-guide.md) and [its
pane](../first-party-plugins/review-guide/pane.md) own the shipped behavior. [Diff
rendering](../diff-rendering.md), [frames](../plugins/frames.md), [shared review
views](../plugins/change-request-ui.md), and [diff review threads and
marks](../diff-rendering/review.md) own the parts outside the plugin. This page lists only work someone
still has to do.

## Walk the terminal client

Nobody has walked the guide in `pnpm dev:tui:agent`. The kit tests cover how the terminal draws
`DiffNote`, `StackedDiff` line stops, and `noteContext`, but no person has looked at them. In the phase 3
attempt, the guide built into the session's data root and its trust prompt was accepted, but the Node
never started the plugin after two restarts. Find out why, then walk the path, the notes, and the Diff
tab's marks.

## Show the note in the agent card

**Ask a follow-up** sends the note's title and body to the agent as context, under a label saying a
plugin wrote it. The agent card doesn't show that note, so the reader can't see everything that goes to
the agent. Asking needs the reader's own click or key press, at most once a second, which keeps
background code from slipping text in. The fix belongs in the agents plugin's `InlineDiffCard`: take the
note as a prop and draw it above the composer, labelled with the plugin that sent it.

## Land on the asked line from the wide pane

From the wide Guide pane, a reveal into the pull request pane stops short of its line when cards or
review threads sit above it, so the agent card opens below the screen. A plain hunk link lands at the
same place, so the cause is `DiffPane`'s reveal, not asking. The reveal should hold the line in place
while the blocks above it are measured, the way scroll restoration does. From the column beside the
diff, the line lands on screen.

## Show marks after a push

When a push makes the pull request's head match the guide's, the Diff tab's marks come back only on the
next refresh, such as a guide change or a reload. The plugin's `head:changed` handler hears the task's
own head move, not the pull request's. The fix is to send `plugin:review-guide:changed` when the code
host reports a new head for the task's change request.

## Decide on posting a note to the code host

Whether a note can become a review comment on the code host was an open question on October 30, 2026.
A note can already become a line conversation through **Ask a follow-up**, so this can be decided now.
The guide itself never posts, approves, or requests changes.

## Later ideas

- Jump from a Diff tab mark to its step. Marks hold no actions, so this is a host change of its own.
- Share progress between people or devices. Progress belongs to one task's guide on one Node.
- Regenerate one step, or a guide per commit.
- Check GitLab and Bitbucket with a fixture. Both were checked by reading the code. They pass the same
  `ChangeRequestDiff` and point shape as GitHub.
