# GitHub surfaces

This page covers how the GitHub plugin's panes and panels are arranged, the conversation timeline, and
the two extension points it opens. The client is in `plugins/github/src/client/`.

## Surfaces

Every GitHub surface is a host layout filled with kit components; the plugin ships no stylesheet
([panes.md](../panes/layout.md) § Layout model, [ui-design.md](../ui-design.md) § The closed kit).

| Surface | Arrangement |
| --- | --- |
| The PR pane | The `single` layout holding one split: the navigator beside the diff, which is browse's inner pair without browse's pull list. The navigator opens with the strip of pull requests this task is about. |
| Navigator | Overview, then the changed files and the conversation as folds. Browse and the PR pane draw the same three trees over the same model. The shared split control closes this column to its edge, keeps its content mounted, and remembers the choice on this device. |
| Overview | The pull's heading and facts (state, author, branch, review decision, checks, age), the merge box, the conflict alert, description, linked issues, labels, checks, reviewers, and the `github:summary-badges` slot. The merge box is two left-aligned rows: the one solid primary for the pull's state (**Merge** beside its method, or **Ready for review** on a draft), then **Convert to draft** and **Close**. A related pull says it is read-only instead. |
| Conversation | The comment and review composers over a timeline of cards: comments, review summaries, commits, and file threads. |
| Browse | Two splits, one inside the other: the pull list, then the navigator beside its diff, or the create form beside its compare preview. |
| The reference panel | A heading, facts, and the host's task-link control, in the box the host draws. |
| The importer | A titled card on the Projects page of setting rows, one per repository, with **Clone** and **Link folder** beside it. A repository that already has a project says "Added as" that project and keeps both buttons. In onboarding the wizard is the frame. |

Two places let another plugin in. `github:diff-line` takes marks on a line of a pull request's diff,
keyed by file, line and side, the same shape the changes pane opens over the working tree.
`github:summary-badges` is a `stack` slot on the overview, so github's own facts stay and up to four
contributors are added beside them ([plugins.md](../plugins.md) § Cooperative extension points).

## Conversation

The conversation is `PrConversation` in `plugins/github/src/client/pullDetail/Conversation.tsx`, a kit
`Timeline` over `buildConversationEntries` in `model.ts`. Its topology is the PR detail, which is
complete when it is served (§ Pull request detail and files), and no route was added for it. Bodies stay
in that detail, because the diff's inline threads and the Linear reference scan read the same bodies
anyway, so a separate body route would fetch them twice.

- **Turn identity.** Every entry's key is `kind:id`: `review:<node id>`, `comment:<id>`,
  `commit:<sha>`, `thread:<thread id>`. The kind stops a SHA, a review id, and a comment id from sharing
  a namespace. An id seen twice in one kind gets `#2`, `#3` in list order. The sort is stable, so a tie
  keeps the order reviews, comments, commits, and threads are listed in. Turns are drawn by key, each
  reading its entry from a signal of its own, so a refetch, a reply, an edited body, or an older comment
  arriving keeps every existing turn's element.
- **Bodies near the viewport.** Each turn's byline, state, and path are drawn at once. GitHub's rendered
  HTML is built only when the turn comes within one screen of the viewport, through `Timeline.Turn`'s
  `near` child, and it stays built after that. Until then the card says the body is shown on scroll.
  Browser find cannot match a body that is not built yet. The terminal client builds every body at once.
  The observer's root is the region scroller found when the first body asks, and it stays that
  element. If the navigator's region were rebuilt around a mounted conversation, bodies would wait
  for a scroller that no longer moves.
- **Thread snippets.** A thread quotes five lines around its line, from the one segment of the pull's
  diff document that holds it (§ Diff documents), so a line at a segment's edge gets less context on
  that side. The conversation loads the document when any thread
  has a line, and `createDiffSnippets` from `@acorn/plugin-api/ui/diff` reads a thread's segment through
  the diff viewer's loader and node cache once its turn comes near. A segment already seen in the diff
  costs no request, and one read here is resident when the diff opens. A file missing from the document
  because GitHub capped the list, a file with no patch, a line in no segment, and a failed load all
  draw **Snippet unavailable.** and load nothing else. An outdated thread has no line and draws no
  snippet. No patch is parsed on the client.
- **No window.** The conversation draws every turn. Its cost per turn is a byline until a turn comes
  near, and it scrolls in the navigator's region rather than a followed timeline of its own, so it does
  not use the transcript's "Show earlier" window.

Keyboard navigation comes from the tree rather than from this plugin: the pull list, the file list,
the check list and the pull strip are kit collections, so the arrows, `j` and `k`, Home, End and
type-ahead all work without a binding of github's own. What is left in `Shortcuts.tsx` is the keyboard
for what is not a list: the file finder, `[` and `]` cycling, and "create pull request". All three are
commands now, and the section below says which of them the palette carries as well.
