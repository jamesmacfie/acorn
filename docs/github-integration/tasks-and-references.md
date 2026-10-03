# Tasks and references

This page covers how a pull request becomes a task, the strip of related pull requests in the PR pane,
and how GitHub links in rendered content resolve inside acorn.

## Tasks and references

A PR can promote to a task. The task stores the core project ID and pull number; the project's GitHub
facet supplies provider owner/name metadata. Subsequent task context and changes use the owning Node.
The PR pane keeps that scalar PR as its primary and adds read-only tabs to the strip from three
sources: durable
`task_pulls` relations, the connected base/head graph of the mirrored open-PR list, and PR links in
the primary description, comments, reviews, and threads. A pull body is GitHub's rendered HTML, and
only the `/pull/` form of a link is taken, so a `Fixes #42` that GitHub wrote as an issue link stays
out of the strip. Stack and mention evidence is derived on read, so retargeting a stack or editing
out a link removes it without a cleanup migration. A linked task destination wins over agent,
mention, and stack destinations; an agent destination opens the recorded managed session through the
existing notice-target seam.

The strip is the kit's `Tabs`, and every tab is labelled `#1234`, so each one carries the mark of the
destination it has: a list for a linked task, a bot for the agent that opened it, a link for a
mention, a branch for a stack neighbour. Selection follows focus in a tablist, so a tab only ever
changes which pull the pane reads. Taking the destination is a control beside the strip, acting on
the selected tab, which is what keeps a reader arrowing along the strip from being carried off to
another task.

The strip is drawn on the desktop only. A terminal has a few lines of chrome above the pane and the
strip wants a whole row of them, so there it collapses to the primary PR; the related ones stay
reachable from the pull list.

Selecting a related PR with no task offers **Create task** beside the strip. Promotion reuses the
repository-list workflow: the new task takes the matching core project, the PR head branch and pull
number, and any unambiguous Linear references from the PR body. If active tasks already own that PR,
the offer is replaced by a control that opens the one owner, or by a chooser over several.

Within a task PR body, another GitHub PR link is a `plugin:select` intent for the existing PR pane,
not a route change or reference-panel overlay. Which pull is selected changes what the navigator and
the diff read but never changes the current task's scalar primary, branch, or worktree. All GitHub writes,
including diff comments and thread actions, are omitted on a non-primary pull.

Linear reference panels are contributed through a provider contract, so the GitHub plugin does not
import Linear's implementation. Linear is a loaded plugin, so the panel it renders there is a
sandboxed frame whose overlay chrome the host draws. GitHub does depend on `@acorn/plugin-linear` for
two things in `contract/`: the ticket-reference text scanner and the query-options factory over
`/v1/p/linear/issues`. Both are the sanctioned cross-plugin surface, and neither reaches Linear's
UI.

## Content links

GitHub declares two content-link recognisers (`plugins/github/src/client/contentLinks.ts`; the shared
recognition and destination ladder is in [plugins.md](../plugins.md) under Client authoring and the UI
kit). A `github.com/<owner>/<repo>/pull/<n>` URL declares `providerId: 'github'`, so a click can open
the reference panel: a pull request is glance-sized enough to answer "what is this" without the reader
losing their place. A bare `github.com/<owner>/<repo>` URL declares no `providerId`, because a
repository is a list rather than a card, and its destination is the browse route.

Both recognisers resolve `owner/repo` to a tracked project by comparing case-insensitively. GitHub
treats an owner and a repo name as case-insensitive, but the two sides of that comparison come from
different places: a URL, and the plugin's own PR mirror, carry GitHub's canonical spelling (for
example `Runn-Fast`), while `projects.github_owner` is stored folded to lower case (`runn-fast`). An
`===` comparison here matched neither a dashboard row nor a PR link inside a rendered body, and it
failed silently, because an unresolved repo simply opens the real `github.com` URL instead of erroring.
