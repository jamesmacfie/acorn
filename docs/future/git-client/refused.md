# Git client scope boundaries

Date: October 7, 2026. Status: planned; implementation not started.
Read the [implementation context](./README.md) before changing these boundaries.

## Refused alternatives

| Alternative | Reason |
| --- | --- |
| Full Tower, SourceTree, or GitKraken parity | Acorn's task/workflow model determines the experience. Hosting, issue/team integrations, and every reference toolbar command are not required for a useful Git client. |
| Keep expanding the separately installed worktree plugin | The agreed destination is a first-party compiled plugin with both-host support and access through the public plugin API. Keep its source as reference; retire its installed registration after replacement acceptance. |
| Put Git business rules in the desktop shell or core task UI | Git owns repository projections and operations. Core retains task lifecycle and contributes only shared coordination and pinned task-start contracts. |
| Duplicate Changes staging and commit UI | Changes already owns working-file diff, staging, discard, commit hooks, and remote actions. Two owners would diverge in state and policy. |
| Run checkout mutations directly from the repository view without a task | Task targeting makes branch ownership, activity checks, setup, and recovery visible. Repository metadata actions remain available without a task. |
| Check an activity flag once before calling Git | Work can start between the read and mutation. Shared admission and authoritative owner projections are required. |
| Block whenever any agent session exists | Idle sessions do not mutate the checkout. Block admitted queued/active/cancelling work and nonterminal workflows, including human gates. |
| Switch the branch recorded on a task when selecting another ref | Selection is inspection. Launch an isolated task or choose an eligible attachment; do not rewrite a task's branch identity behind its other owners. |
| Use stash list indices as stable identities | Selectors shift after creation/drop/pop. Carry an immutable object and roster revision, and refuse stale destructive actions. |
| Automatic stash, reset, clean, or discard before an operation | These hide side effects and recovery decisions. Refuse a dirty target and let the person resolve it through Changes. |
| General Git shell/config form or agent mutation tools | The feature needs typed person-initiated operations. Arbitrary cwd, flags, config keys, executable transport helpers, and cross-task agent writes broaden authority without a product requirement. |
| Bare force push or generic Undo/Redo | Preserve Changes' lease-based push behavior. A single Undo label cannot explain Git's operation-specific recovery or external changes. |
| Draggable workflow graph for commit history | History needs dense, connected rows. The shared kit owns compact geometry and the terminal owns a relationship-row projection. |
| Mirror Git objects, stashes, or operation state into task tables | Git already owns that state; a second copy requires synchronization and can misreport recovery. Store preferences and task relationships only in their proper owners. |
| Eagerly load every commit and patch | Large repositories and remote Nodes require paging, lazy segments, cancellation, byte limits, and named omissions. |
| Automatically explain every selection | AI generation consumes a chosen backend and may omit content. Require an explicit action and show the model, limits, and result state. |
| Fetch on mount, refresh, or every client timer | Read actions must remain local. Auto-fetch is opt-in and scheduled once by the Node per repository. |

## Deferred functionality

Interactive rebase, reflog browsing, general reset/recovery UI, submodule management, credential and
signing-key management, and a general patch/hunk stash editor are outside these eight phases. They
need separate designs for recovery, secrets, or editor interactions. Branch comparison and the
operation-specific controls in this plan do not imply those broader tools.

Cross-process transactions with arbitrary external Git clients are also not promised. Acorn
coordinates its own owners, validates freshness, and reports Git failures; external processes can
still alter refs, the index, or files. Tests must demonstrate detection and refusal where possible,
and the product must describe the remaining limits honestly.

## Verify before building

- Check whether Changes or another shipped owner has gained a deferred capability before adding it.
- If a boundary must change, record its user need, owning layer, recovery behavior, and verification
  in the context before implementing it.
