# Review guide v2: a path through the change, with notes on lines

Date: October 30, 2026. Status: proposed. No phase started.

## What this is

The review guide plugin already groups a change's hunks into sections and says why each one exists
([the review guide plugin](../../first-party-plugins/review-guide.md)). This plan turns it into a
path a reviewer walks, and lets the agent pin short notes to the lines that need them:

- **A path.** An overview, then numbered steps, then a wrap-up. Each step says what you'll know after
  it, why the change exists, and shows its hunks. You mark a step reviewed and move to the next one.
  The steps follow the change the way it runs, starting where the data or the request comes in.
- **Notes on lines.** The agent leaves a few notes pinned to single lines. Each has a tone:
  **Explains** for context, **Look closely** for a judgment call, and **Risk** for a likely bug. The
  rail shows each step's notes as dots, so a reviewer sees where the risk is before starting.
- **The same diff and the same ✦.** Hunks draw with the diff kit's rows, and a note looks like the
  inline agent card. Hovering any line shows the ✦ button from the pull request diff. Asking a
  follow-up opens that same line conversation, so it also shows in the **Diff** tab.
- **Notes in the Diff tab.** The guide adds its notes as marks under the rows of the pull request's
  own diff, so a reviewer who skips the guide still sees them.
- **A wrap-up.** Every Look closely and Risk note becomes a checklist item. The guide sends the
  reviewer to the pull request's own review controls. It never approves anything itself.

Linear's guided reviews are the reference for core changes first, glue split out, and each part
explaining what changed and what follows from it
([Linear Diffs](https://linear.app/changelog/2026-05-27-linear-diffs)). The rail, step goals, line
notes, and wrap-up are Acorn's own design.

## The design to build against

[ux-spike.html](./ux-spike.html) is a clickable mockup with sample data from the site's billing-api
fixture. Open it in a browser. Its tabs show the full-width guide, the guide beside the diff, and the
Diff tab with the guide's marks. **Design notes** in its header explains each choice. The phases
below follow it. Where a phase departs from it, the phase says so.

## The phases

| Phase | What it delivers | Depends on |
| --- | --- | --- |
| [1. Steps and line notes in the answer](./01-steps-and-line-notes.md) | The harness answers with steps, goals, and notes pinned to quoted lines. A check in code drops any note that doesn't match its line. The current pane draws the notes in a plain list. | Nothing |
| [2. Notes on diff rows](./02-notes-on-diff-rows.md) | `StackedDiff` takes notes and draws them under their lines in the inline agent card's shape, on both hosts, plus an `ask` event from the ✦ button. | 1 |
| [3. The review path](./03-the-review-path.md) | The overview, step pages, wrap-up, saved progress, and keyboard moves. A wide layout with a rail in the Guide pane, and a stepper in the column beside the diff. | 2 |
| [4. Ask from the guide](./04-ask-from-the-guide.md) | **Ask a follow-up** and the ✦ button open the inline agent card on that line in the pull request diff, with the note as context. | 2 |
| [5. Notes in the Diff tab](./05-notes-in-the-diff.md) | The task in the code hosts' `diff-line` key, and the guide's notes as marks under the rows of the pull request diff. | 1 |

Phase 5 can run beside phases 2 to 4. Phases 3 and 4 are independent of each other.

## Rules no phase may break

| Rule | Why |
| --- | --- |
| Every hunk still appears in the guide exactly once. The coverage check stays as it is. | A reviewer who trusts a guide doesn't look for what it left out. |
| A note shows only on a line whose text it quotes. The check runs in code, not in the prompt. | Agents misnumber lines. A note on the wrong line is worse than no note. |
| Notes stay short and few: a title of at most 120 characters, a body of at most 600, three notes per hunk, and 40 per guide. | A diff covered in notes is a diff nobody reads. The title cap also fits a diff mark's 200-character text. |
| Every change is additive. `PLUGIN_API_MAJOR` stays where it is. | Installed plugins keep loading ([AGENTS.md](../../../AGENTS.md)). |
| The guide stays a loaded plugin that draws remote trees. | It reaches the Node only through its manifest, and the terminal client draws the same tree. |
| The guide never approves, requests changes, or posts to the code host. | Those are the reviewer's decisions, and they already have controls in the pull request view. |
| Generating a guide is still something the person starts. | Each guide spends harness usage. |

## Not in scope

- Posting a note to the code host as a review comment. This was an open question on October 30, 2026.
  Decide it after phase 4, when a note can already become a line conversation.
- A click action on a diff mark, such as jumping from a mark to its step. Marks hold no actions
  ([annotations](../../plugins/rows-and-annotations.md#annotations)), and adding one is a host change
  of its own.
- Progress shared between people or devices. Progress belongs to the task's guide on one Node.
- Asking from the guide in the terminal client. There, showing a line opens the editor, which has no
  agent card.
- Regenerating one step, or a guide per commit.

## When it ships

Describe the behavior in the owning reference pages and remove these files, as
[writing docs](../../writing-docs.md) says. The owners are likely
[the review guide plugin](../../first-party-plugins/review-guide.md) for phases 1 and 3,
[every node at 80 by 24](../../ui-design/every-node.md) and [diff rendering](../../diff-rendering.md)
for phase 2, [frames](../../plugins/frames.md#showing-a-line-in-the-change-request) and
[shared review views](../../plugins/change-request-ui.md) for phase 4, and
[diff review threads and marks](../../diff-rendering/review.md#marks-from-other-plugins) for phase 5.
Delete `ux-spike.html` with them.
