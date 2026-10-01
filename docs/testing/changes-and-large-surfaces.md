# Changes and large-surface checks

Run these checks for commit controls, large diffs, long transcripts, and task restoration.
The numbers retain their original acceptance-check IDs.

## Changes pane

The next four are the Changes panel's ([diff-rendering.md](../diff-rendering.md) § Data flow). The
pane's own suites cover the parser, the routes, the checkbox, the editor's state and every remote state
of the bar against a bare repository in a temp directory. What they cannot see is which diff the column
swaps to when a checkbox moves, whether a keystroke in the message field reaches a command, and what a
real remote with real credentials does.

43. Open the Changes pane on a task with both staged and unstaged edits. Tick a row's checkbox: the
    file moves, the group checkbox above it follows, and the diff column switches to the staged side
    of that file. Untick it and the column goes back. Tick a group checkbox that is showing the
    indeterminate mark and only the unstaged files under it move. Then check the rail: its dirty count
    and the header's totals agree after every one of those actions.
44. On a task with two edited files and one untracked file and nothing staged, type a message in the
    commit field. The button reads **Commit tracked**. Narrow the pane until the diff takes the whole
    column and come back: the message is still there, and so is it after a relaunch. Press Cmd+Enter
    with the keys still in the field, and both edited files land in one commit with the untracked file
    untouched. Then open the options menu, turn Amend on with the field empty, and the last commit's
    message appears; Cmd+Option+Enter from the field amends. Press the expand button and the same text
    is in the modal, with room for a body.
45. On a task whose branch has never been pushed, the bar above the commit editor names the project
    and the branch, its button reads **Publish**, and the counts beside it read "no upstream". Press
    it: the button reads **Fetch** and the counts go quiet. Commit something and the button reads
    **Push** with **↑1** beside it; press that, then amend the commit from the options menu and press
    **Push** again. It is refused, and the reason ends by pointing at Force push. Open the menu
    beside the button, press **Force push** once — the item reads **Force push?** — and press it again;
    the push lands. Then have somebody else, or a second clone, push to the same branch and press
    **Fetch**: the counts read **↓1** and the button reads **Pull**. Copy the project folder from the
    button beside the branch name, which used to be in the header. Pull a branch that has diverged and
    the refusal names Pull with rebase; take it, and if it conflicts the banner reads **Rebase in
    progress**, the Conflicts group is first in the list, the primary button is disabled, and **Abort**
    puts the branch back where it was. Last, commit from a terminal in the same worktree and watch the
    ahead count move without touching the pane.
46. With no model provider connected and no agent CLI installed, the commit toolbar has no wand at the
    left of it. Add one in Settings, under AI models, reopen the pane, and stage two files.
    Press the wand: it spins, and
    within ten seconds the editor holds a subject and a body. Commit, and the message lands. Now type
    a message of your own and press the wand again: it reads **Replace?** and does nothing until a
    second press. Connect a second provider, press the chevron beside the wand, pick the other one,
    and press the wand: the tooltip and the message both come from the provider you picked, and the
    pick survives a relaunch. Disconnect both providers and the wand goes.
47. On a task in a GitHub-mirrored project whose branch has never been pushed, there is nothing under
    the branch bar. Press **Publish**, and **Open pull request** appears there; press that, and the
    create form opens with this branch already chosen as the head. Create the pull request and go back
    to the Changes pane: the button is gone and the PR pane is in the switcher. Then disable the GitHub
    plugin in Settings and reopen the pane on a pushed branch: the footer is the same height it is with
    the plugin on, with no gap where the button was.

## Large repositories, transcripts, and task state

79. Archive a task with a committed change and find it on the Archive page by a word from its agent
    transcript. Open the matching session in the preview, and check that its right rail holds only Agent
    and Notes. Restore it and check that the worktree comes back with the commit. Then
    delete the branch of another archived local task and check that restore asks before it cuts a new
    one.
80. Open a Shell tab on one task and run a command that prints a line a second. Switch to a task
    without the terminal drawer open, wait ten seconds, and come back. The same terminal is there with
    every line printed while you were away. Open more than four terminals across tasks and switch
    between them: each draws, and none goes blank after its GPU context is given to another. Close the
    tab and check that switching back does not bring it back.
81. With GitHub connected, open a pull request with more than 100 files, more than 100 commits, or a
    review thread with more than 100 comments. Every file, commit, and comment is there in GitHub's
    order. Open one with more than 3,000 files: the diff and the file list both say GitHub returned
    3,000 of its total. Compare two branches with more than 300 changed files in the create form: the
    count reads "first 300 files" and the preview says the comparison may have more.
82. Open the diff of the largest pull request to hand, in unified and then split. The scrollbar is its
    final length at once, file headers and the widest line are in place before their rows, rows appear
    plain and then take colour, and a thread's space is there before its segment loads. Drag the
    scrollbar to the end and back: every segment you land on draws within a moment and nothing between
    loads. Find a word that appears only near the end and step to it. Expand a gap, collapse a file from
    the sticky header, and leave the pane open for a minute: the health snapshot shows nothing queued.
    In split mode, scroll a long line sideways before its colour arrives: it stays scrolled when the
    colour lands. Find a match in split mode: the view lands on the band that holds it. With find
    open, expand a gap above the match: the view does not jump back to the match.
    Then do the same in the Changes pane while an agent edits a file: only that file's segments
    reload, and the reader stays where they were. Run `git config diff.noprefix true` in the task's
    worktree and reopen the Changes pane: every changed file still shows its diff. Unset it afterwards,
    because the setting is the whole repository's.
83. In that pull request, scroll to a place with a thread a screen above you and one below. Expand
    and collapse the one above, reply in it so the box grows, and resolve it: the line you are reading
    does not move. Open a `<details>` block and wait for a late image in the one below: nothing on
    screen moves. Open a line composer on screen: what follows moves down once, with no frame where the
    composer overlaps the next line. Flick-scroll through several threads: nothing jumps while you
    move, and the view settles without a correction you can see. Narrow the pane by dragging the
    sidebar, then widen it: the same line stays at the top. Leave the pane and take a health snapshot:
    no observers, no scheduled frames, and `maxAnchorDrift` under a pixel.
84. Open that pull request's diff, scroll to the middle, and switch to another task and back: the
    rows you left are on screen, coloured, before any segment request, and the health snapshot's
    `resident.hits` rose. Open a dozen other large diffs one after another: `resident.rows` and
    `resident.estimatedBytes` stay under `rowCeiling` and `byteCeiling`. In the Changes pane, let an
    agent save the same file several times: `resident.segments` does not grow with each save.
85. Open the `canonical` fixture's Agent pane: it opens on the newest cards with **Show earlier** above
    them, and the health snapshot shows 200 mounted of about 3,400 turns. Scroll a little way up and
    press **Show earlier**: the card you were reading stays put. Select text across two cards, scroll
    to the foot, and let a live session stream past 400 cards: the selection survives, and once you
    clear it the next page of cards trims the window back to 200. The console shows no
    `ResizeObserver loop` error while the stream passes 400 cards. Press **Go to top**: the oldest turn
    is on screen, and the page's find matches its text. Open a notice for an old request: its card is
    drawn and focused. With VoiceOver, a card reads its place in the whole session. In a pull request
    with many threads, open the conversation and scroll: each comment's HTML and each thread's snippet
    appear before you reach them, a capped file's thread says **Snippet unavailable.**, and nothing
    already drawn is rebuilt when the pull refetches.
