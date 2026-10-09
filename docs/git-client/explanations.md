# Git explanations and first release

The Git plugin offers explicit explanations for selected commits and stashes on desktop and terminal.
This page describes model choice, context limits, and replacement of the external worktree manager.

## Explain a change

Open **Git > History**, select a commit, and press **Explain commit**. For a stash, open
**Git > Stashes**, select an entry, and press **Explain stash**. The task Git pane offers the same
actions. Selecting, refreshing, or paging through Git data does not start generation.

The control uses Acorn's shared **Generate with** and **Model** picker and remembers the device's
generation choice. The Node validates the selected backend and model against its available list
before calling the public model service. If the backend has gone, choose another and retry.
The control shows generation, cancellation, provider failure, an empty answer, and retry. Changing
the selected object, comparison parent, project, or Node cancels the request and rejects late output.
The client retains up to 16 answers by Node, project, object, comparison base, backend, and model.
Answers do not alter Git commits, stashes, task transcripts, or agent sessions.

`plugins/git/src/server/explain.ts` supplies bounded commit metadata, up to 60 file summaries,
and at most 40 KiB of patch text. Stash context includes captured untracked content where it fits.
The Node names omitted files, binary content, truncated metadata, and unavailable or oversized
patches in both the model context and the result. It passes the HTTP abort signal into the model
service. Git messages, paths, and patches are JSON data in the user prompt, separate from the
system instruction that says repository content is untrusted. Explanation reads do not acquire a
checkout mutation lock.

The paired-device route is `POST /v1/p/git/projects/:projectId/explanations/:kind/:id`, with
`kind` equal to `commit` or `stash`. Its body is `{ backendId, modelId, base }`; the Node resolves
the project mapping and validates the immutable object and comparison. The result is
`{ text, backendId, modelId, omissions }`. Wire types live in `plugins/git/src/shared/api.ts`.

## Replace the external worktree manager

The first release contains **History**, **Stashes**, and **Worktrees** under the built-in **Git**
source. Select a Git project on the intended Node, then open **Git > Worktrees** to inspect its
registrations and task owners. The external package uses plugin ID `worktree-manager` and source ID
`worktrees`; the built-in plugin uses ID `git`. The two registrations are independent.

Check **Settings > Plugins > Installed** for each Node separately. An absent external plugin needs
no change. If `worktree-manager` is installed and Git's first-release flows work on that Node,
disable that exact plugin on that Node, or uninstall it with **Keep its data**. A disabled plugin
may remain running until the Node restarts; the status shows both facts. A remote Node requires its
own Git availability and replacement check. If built-in Git is disabled, enable it and complete
acceptance before retiring the external plugin. Keep the external source checkout and repository,
worktree, stash, task, plugin data, and unrelated layout and activation preferences.

Phases 05–08 add task and workflow launches, refs and remotes, Git settings, operations, and
conflict resolution. They are outside this first-release contract.
