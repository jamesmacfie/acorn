# The review guide's pane

This page covers how the [review guide plugin](../review-guide.md) draws a guide: the path, its pages,
the notes, and the two layouts. It's part of [first-party plugins](../../first-party-plugins.md).

## The path

**Guide** is a task pane drawn as a remote tree, so the desktop and the terminal client draw the same
one. Its toolbar has ✦ **Generate guide** or **Regenerate**, or **Stop** while a guide generates. While a
guide generates, the pane links to the session's transcript through its `session` destination.

**Generate guide**, **Regenerate**, and a failed guide's **Try again** all open one dialog,
`GenerateModal` in `src/tree/GenerateModal.tsx`. Its body takes optional extra context, up to 2,000
characters. Its actions start with the ✦ `ModelPickerPopover`, the same model picker and in the same place
as the app's other AI dialogs, with a `ModelBackendPicker` over the harnesses inside. It reads
`GET /backends` when the dialog opens, and starts on the person's saved harness and its default model.

A guide reads as a path: an overview, one page per step, and a wrap-up. The hunks the guide left out
are a last step, **Not covered by the guide**, so every hunk is on exactly one page. The path is
built by `guidePath` in `src/shared/path.ts`, which the route also uses to check a progress mark.

- **The overview** has the summary, who wrote the guide, the counts (steps, hunks, files, lines added
  and removed, minutes, and notes by tone), a card per step, and the coverage line. **Start the path** marks it reviewed and opens step 1.
- **A step** has "Step 2 of 3", its kind, and its minutes, then its title, why, and hunks. Its
  foot names the next step and has **Back** and **Mark reviewed & continue**.
- **The wrap-up** lists every **Look closely** and **Risk** note as a checkbox, with its path and
  line, a link to its step, and its tone, and counts what's still open. The guide doesn't approve or
  post anything, so the page tells the reader to leave their review in **Details**. It counts as done
  once every step is reviewed and every note on it is checked.

A step's minutes are one per 40 changed lines, at least one, worked out in code, so the pane says
"~". A fresh guide opens on the first page that isn't done, so a reader who closes it comes back to where
they stopped.

Leaving a pane unmounts its tree, so the pane keeps the page each guide had open in the plugin's
worker, keyed by the task and the guide's `createdAt`. A pane drawn again opens on that page, and a
regenerated guide, with a new `createdAt`, starts fresh. The worker ends 30 seconds after its last tree
closes, and the guide then opens on the first page that isn't done. The wide layout's columns pass a
`scrollKey` per page and one for the rail, so the host puts each back where it was for the session. The
column beside the diff scrolls in the code host's view, which keeps no place for a tree.

Each hunk is a `StackedDiff` under a link named by its path and first line, such as
`src/billing/invoice.ts:42`. Each note is a `DiffNote` under its line, with its body as Markdown and two
buttons: **Show in diff**, and **Mark checked** for Look closely and Risk, or **Got it** for Explains,
which folds the note. A hunk with no new side, such as a deleted file's, starts on its old side, and its
link shows only the path. A link or **Show in diff** opens the task's change request diff at that line
([showing a line in the change request](../../plugins/frames.md#showing-a-line-in-the-change-request)).

While `matchesChangeRequest` holds, each `StackedDiff` sets `conversations`, so the host draws the
change request's agent card on its lines
([asking about a change request line](../../plugins/remote-trees.md#asking-about-a-change-request-line)).
A note is the card's opening message, with its buttons under it and a reply box under them. ✦ on any
line opens an empty card there. Both stay in the guide: nothing switches panes. The card is the line's
conversation in the change request's **Diff** tab too, where the note draws as the same card, so a
reader can start in one and carry on in the other. A session starts only when the reader sends, and the
first send gives the agent the note, labelled as the guide's, then the code around the line. Beside the
diff only the noted lines are drawn, so only they hold a card. The Diff tab beside it has the rest.

On a guide whose commit isn't the change request's head, or with no agents plugin, notes draw on their
own and ✦ shows the line in the change request's diff. A ready guide in that state says so above its
page, naming both commits from the view's `changeRequestHead`, and asks the reader to push or regenerate.

In the terminal client there's no agent card. Notes draw with their body and buttons, ✦ is Enter on the
line, and it, a link, and **Show in diff** open the file in the editor.

Only the open page draws its hunks, because the host refuses a tree batch over 1 MiB. In one step
whose hunk text passes 256 KiB, the later hunks wait behind closed folds.

## Two layouts

The tree has two entries. `pane` fills the Guide pane with the wide layout: a rail on the left with
**Review path**, a progress line such as "2 of 5 done · ~5 min" with a meter, and a row per page. A
step's row shows its number or a check, its title, its kind, its hunk count, its minutes, and a dot per
note in its tone. The open page is on the right, at a pane's reading width and centered
(`measure="pane"`), as the Notes pane's reading column is. The toolbar and the split are the tree's own
top-level nodes, because the pane's region drops its side padding only for a split that's its direct
child.

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
