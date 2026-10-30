# The review guide's pane

This page covers how the [review guide plugin](../review-guide.md) draws a guide: the path, its pages,
the notes, and the two layouts. It's part of [first-party plugins](../../first-party-plugins.md).

## The path

**Guide** is a task pane drawn as a remote tree, so the desktop and the terminal client draw the same
one. Its header has the harness picker and **Generate guide**, **Regenerate**, or **Stop**. While a
guide generates, the pane links to the session's transcript through its `session` destination.

A guide reads as a path: an overview, one page per step, and a wrap-up. The hunks the guide left out
are a last step, **Not covered by the guide**, so every hunk is on exactly one page. The path is
built by `guidePath` in `src/shared/path.ts`, which the route also uses to check a progress mark.

- **The overview** has the summary, who wrote the guide, the counts (steps, hunks, files, lines added
  and removed, minutes, and notes by tone), "By the end you'll know" with each step's goal, a card per
  step, and the coverage line. **Start the path** marks it reviewed and opens step 1.
- **A step** has "Step 2 of 3", its kind, and its minutes, then its title, goal, why, and hunks. Its
  foot names the next step and has **Back** and **Mark reviewed & continue**.
- **The wrap-up** lists every **Look closely** and **Risk** note as a checkbox, with its path and
  line, a link to its step, and its tone, and counts what's still open. The guide doesn't approve or
  post anything, so the page tells the reader to leave their review in **Details**. It counts as done
  once every step is reviewed and every note on it is checked.

A step's minutes are one per 40 changed lines, at least one, worked out in code, so the pane says
"~". The pane opens on the first page that isn't done, so a reader who closes it comes back to where
they stopped.

Each hunk is a `StackedDiff` under a link named by its path and first line, such as
`src/billing/invoice.ts:42`. Each note is a `DiffNote` under its line, in the inline agent card's
shape, with the body as Markdown and three buttons: **Ask a follow-up**, **Show in diff**, and **Mark
checked** for Look closely and Risk, or **Got it** for Explains, which folds the note. A hunk with no
new side, such as a deleted file's, starts on its old side, and its link shows only the path. A link or
**Show in diff** opens the task's change request diff at that line
([showing a line in the change request](../../plugins/frames.md#showing-a-line-in-the-change-request)).

**Ask a follow-up** and ✦ on any line also open the inline agent card on that line of the diff
([asking about the line](../../plugins/frames.md#asking-about-the-line)). **Ask a follow-up** sends the
note's title and body as context for the agent, and ✦ sends none. In the Guide pane this switches to
the change request's pane, where the card lives. Beside the diff, the diff next to it scrolls and opens
the card. The conversation is the diff's own, so it stays on that line in the **Diff** tab. The guide
doesn't show whether a note already has a conversation, because it can't read agent sessions.

In the terminal client every one of these opens the file in the editor instead, and ✦ is Enter on the
line.

Only the open page draws its hunks, because the host refuses a tree batch over 1 MiB. In one step
whose hunk text passes 256 KiB, the later hunks wait behind closed folds.

## Two layouts

The tree has two entries. `pane` fills the Guide pane with the wide layout: a rail on the left with
**Review path**, a progress line such as "2 of 5 done · ~5 min" with a meter, and a row per page. A
step's row shows its number or a check, its title, its kind, its hunk count, its minutes, and a dot per
note in its tone. The open page is on the right.

`panel` fills the `review-panel` point on GitHub, GitLab, and Bitbucket, so a task's change request
view has a **Guide** tab beside the diff
([shared review views](../../plugins/change-request-ui.md#extension-points)). It's narrow: the progress
line and a numbered button per page on top, then the page. A page there shows only the lines that
carry notes, through `StackedDiff`'s `noteContext`, because the full diff is in the next column. A hunk
with no notes is its link alone. Opening a step there shows its first hunk in the diff beside it. The
wide layout doesn't, because there it would switch panes.

The two read the same progress. The pane stays for a task with no change request view open.

There are no keys for moving through the path. A tree gets no key events, and a loaded plugin's
keybinding must use a modifier and can run only a host verb, none of which reaches the tree
([keybindings](../../plugins/commands.md#keybindings)).
