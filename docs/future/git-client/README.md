# Git client: open acceptance

Date: October 7, 2026. Status: phases 01 to 08 shipped by October 11, 2026. This page holds only the
acceptance still open. Delete the folder when the list is empty. The phase plans, their dated
evidence, and the refused alternatives are in git history.

The pages under `docs/git-client/` own the shipped behavior, starting at
[worktrees](../../git-client/worktrees.md). [Explanations](../../git-client/explanations.md) covers
replacing the external `worktree-manager` plugin on each Node.

## Open checks

- [ ] In the terminal client, the Changes pane read "No changes" while a merge stopped on a
      conflict, so **Mark resolved** wasn't checked there. The October 11 run staged the file with
      `git add`.
- [ ] In the terminal client, a refused operation followed by a retry from the same dialog wasn't
      driven. The desktop run covered it.
